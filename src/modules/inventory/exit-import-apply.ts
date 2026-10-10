import "server-only";

import { dec, isAppError, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { resolveConversion, type Capture } from "@/platform/catalog";
import type { JobHandlers } from "@/platform/jobs";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import { EXIT_IMPORT_JOB_TYPE, exitKey, formatExitDay } from "./exit-import";
import { formatStock } from "./movements";

/**
 * Registering the exits of a confirmed file, in the worker (IMP-10). The
 * rows were fixed when the file was confirmed; this goes through the
 * pending ones in batches, each batch in one transaction, and each row
 * becomes an `EXIT` movement like one registered by hand: the quantity is
 * converted with the product as it is now, and the balance never goes
 * below zero.
 *
 * Two things keep a sale from leaving stock twice. Inside an import, a
 * row already marked is never taken again, so a retry continues where it
 * stopped. Across imports, the folio: before registering, the row looks
 * for the same sale of the same product already applied — by any file —
 * and, if it is there, is marked as a duplicate and moves nothing. The
 * unique index on that key is the last defense.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/** Rows registered per transaction. */
const BATCH = 50;

export type ApplyExitImportOutcome =
  | {
      ok: true;
      status: "DONE";
      applied: number;
      duplicates: number;
      failed: number;
    }
  | { ok: false; reason: "not_found" | "not_confirmed" | "stopped" };

const HELD = {
  id: true,
  status: true,
  totalRows: true,
  appliedRows: true,
  duplicateRows: true,
  failedRows: true,
  confirmedByUserId: true,
  createdByUserId: true,
  file: { select: { name: true } },
} as const;

const notRegistered = (pending: number) =>
  pending === 1
    ? "Falta 1 salida por registrar"
    : `Faltan ${pending.toLocaleString("es-MX")} salidas por registrar`;

/**
 * Ends an import of exits that cannot go on: the exits registered stay,
 * the rest are not registered, and the reason is kept for people. Returns
 * false when it had already ended.
 */
async function failExitImport(
  organizationId: string,
  importId: string,
  why: { message: string; motivo: string },
): Promise<boolean> {
  return forOrganization(organizationId).$transaction(async (tx) => {
    const [id] = await lockRows(tx, "exitImport", [
      String(importId).slice(0, 36),
    ]);
    const row = id
      ? await tx.exitImport.findFirst({ where: { id }, select: HELD })
      : null;
    if (!row || (row.status !== "CONFIRMED" && row.status !== "RUNNING")) {
      return false;
    }
    const pending =
      row.totalRows - row.appliedRows - row.duplicateRows - row.failedRows;
    await tx.exitImport.updateMany({
      where: { id: row.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        lastError: `${why.message} ${notRegistered(pending)}: sube de nuevo el archivo; las que ya se registraron no se repiten.`,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      // Nobody did this: the system stopped it.
      actorUserId: null,
      action: "inventory.exit_import_failed",
      target: { type: "exit_import", id: row.id },
      metadata: {
        archivo: row.file.name,
        motivo: why.motivo,
        salidasRegistradas: row.appliedRows,
        sinRegistrar: pending,
      },
    });
    return true;
  }, LOCKING_TRANSACTION);
}

type PendingRow = {
  id: string;
  row: number;
  externalId: string;
  day: Date;
  productId: string;
  presentationId: string | null;
  quantity: string;
  locationId: string;
};

type RowOutcome =
  | { kind: "done"; movementId: string }
  | { kind: "duplicate" }
  | { kind: "failed"; error: string };

/**
 * One row: its exit, or why not. The product and the location are locked
 * by the batch, so what is read here is what holds when it is written.
 */
async function registerRow(
  tx: Tx,
  actor: { organizationId: string; userId: string },
  line: PendingRow,
): Promise<RowOutcome> {
  const key = exitKey(line.productId, line.externalId);
  // The same sale of this product, already out of stock by any file.
  const before = await tx.exitImportRow.findFirst({
    where: { appliedKey: key },
    select: { id: true },
  });
  if (before) return { kind: "duplicate" };

  const product = await tx.product.findFirst({
    where: { id: line.productId },
    select: { id: true, sku: true, name: true, status: true },
  });
  if (!product) return { kind: "failed", error: "El producto ya no existe." };
  if (product.status !== "ACTIVE") {
    return {
      kind: "failed",
      error: `${product.sku} se archivó después de confirmar. Reactívalo y sube el archivo de nuevo.`,
    };
  }
  const location = await tx.location.findFirst({
    where: { id: line.locationId },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!location) return { kind: "failed", error: "La ubicación ya no existe." };
  if (location.archivedAt) {
    return {
      kind: "failed",
      error: `«${location.name}» se archivó después de confirmar: de ahí ya no pueden salir existencias.`,
    };
  }

  // Converted now, with the rule and the presentation as they are (INV-09).
  const capture: Capture = line.presentationId
    ? {
        kind: "presentation",
        quantity: line.quantity,
        presentationId: line.presentationId,
      }
    : { kind: "base", quantity: line.quantity };
  const resolved = await resolveConversion(tx, product.id, capture);
  if (!resolved.ok) return { kind: "failed", error: resolved.error };
  const { conversion } = resolved;
  const unitCode = resolved.product.unitCode;
  const base = conversion.baseQuantity;

  // One statement checks and takes: a location never gives more than it
  // holds (MOV-01); the CHECK of the table is the last defense.
  const taken = await tx.stockBalance.updateMany({
    where: {
      productId: product.id,
      locationId: location.id,
      quantity: { gte: base.toString() },
    },
    data: { quantity: { decrement: base.toString() } },
  });
  if (taken.count !== 1) {
    const held = await tx.stockBalance.findFirst({
      where: { productId: product.id, locationId: location.id },
      select: { quantity: true },
    });
    const there = dec(held?.quantity.toString() ?? 0);
    return {
      kind: "failed",
      error: there.isZero()
        ? `No hay existencias de ${product.sku} en ${location.name}. Corrige el inventario (entrada, ajuste o conteo) y sube el archivo de nuevo.`
        : `Solo hay ${formatStock(there.toString(), unitCode)} de ${product.sku} en ${location.name}: no pueden salir ${formatStock(base.toString(), unitCode)}. Corrige el inventario y sube el archivo de nuevo.`,
    };
  }

  const movementId = newId();
  await tx.stockMovement.create({
    data: {
      id: movementId,
      organizationId: actor.organizationId,
      type: "EXIT",
      reason: `Salida del ${formatExitDay(line.day.toISOString().slice(0, 10))}, importada de un archivo`,
      reference: line.externalId,
      idempotencyKey: `exit-import:${line.id}`,
      createdByUserId: actor.userId,
    },
  });
  await tx.stockMovementLine.create({
    data: {
      id: newId(),
      organizationId: actor.organizationId,
      movementId,
      lineNumber: 1,
      productId: product.id,
      locationId: location.id,
      direction: "OUT",
      capturedQuantity: conversion.capturedQuantity.toString(),
      capturedUnitCode: conversion.capturedUnitCode,
      presentationId: conversion.presentation?.id ?? null,
      presentationVersionId: conversion.presentation?.versionId ?? null,
      factor: conversion.factor.toString(),
      baseQuantity: base.toString(),
      unitCode,
    },
  });
  return { kind: "done", movementId };
}

/**
 * Registers what is pending of an import of exits. Returns when nothing
 * is left; throws on anything unexpected, so the queue tries again later.
 */
export async function applyExitImport(
  organizationId: string,
  importId: string,
  options: { batchSize?: number; onBatch?: () => Promise<void> | void } = {},
): Promise<ApplyExitImportOutcome> {
  const client = forOrganization(organizationId);
  const batchSize = Math.min(Math.max(options.batchSize ?? BATCH, 1), 200);
  const id = String(importId).slice(0, 36);

  for (;;) {
    // Each batch registers exits in the name of whoever confirmed the
    // file: before every one, check they may still do it (NEG-20).
    const gate = await client.exitImport.findFirst({
      where: { id },
      select: { status: true, confirmedByUserId: true, createdByUserId: true },
    });
    if (gate && (gate.status === "CONFIRMED" || gate.status === "RUNNING")) {
      try {
        for (const permission of [
          "inventory.import.confirm",
          "inventory.exit.create",
        ] as const) {
          await assertModulePermission(
            organizationId,
            gate.confirmedByUserId ?? gate.createdByUserId,
            permission,
          );
        }
      } catch (error) {
        if (!isAppError(error) || error.kind !== "forbidden") throw error;
        await failExitImport(organizationId, id, {
          message:
            "La importación se detuvo: quien la confirmó ya no puede registrar salidas en esta empresa.",
          motivo: "sin_permiso",
        });
        return { ok: false, reason: "stopped" };
      }
    }

    const step = await client.$transaction(
      async (tx) => {
        // Cancelling or another worker cannot slip in between.
        const [locked] = await lockRows(tx, "exitImport", [id]);
        const row = locked
          ? await tx.exitImport.findFirst({
              where: { id: locked },
              select: HELD,
            })
          : null;
        if (!row) return { end: "not_found" as const };
        const done = {
          end: "done" as const,
          applied: row.appliedRows,
          duplicates: row.duplicateRows,
          failed: row.failedRows,
        };
        if (row.status === "DONE") return done;
        if (row.status === "CANCELLED" || row.status === "FAILED") {
          return { end: "stopped" as const };
        }
        if (row.status !== "CONFIRMED" && row.status !== "RUNNING") {
          return { end: "not_confirmed" as const };
        }
        const actor = {
          organizationId,
          userId: row.confirmedByUserId ?? row.createdByUserId,
        };
        const lines = await tx.exitImportRow.findMany({
          where: { importId: row.id, status: "PENDING" },
          orderBy: { row: "asc" },
          take: batchSize,
          select: {
            id: true,
            row: true,
            externalId: true,
            day: true,
            productId: true,
            presentationId: true,
            quantity: true,
            locationId: true,
          },
        });

        if (lines.length === 0) {
          await tx.exitImport.updateMany({
            where: { id: row.id },
            data: { status: "DONE", finishedAt: new Date(), lastError: null },
          });
          await recordAuditEvent(tx, {
            organizationId,
            actorUserId: actor.userId,
            action: "inventory.exit_import_applied",
            target: { type: "exit_import", id: row.id },
            metadata: {
              archivo: row.file.name,
              salidasRegistradas: row.appliedRows,
              yaImportadas: row.duplicateRows,
              conProblemas: row.failedRows,
            },
          });
          return done;
        }

        // The same locks as a manual exit, taken before anything is read
        // and always in the same order: products, then locations.
        await lockRows(
          tx,
          "product",
          lines.map((line) => line.productId),
        );
        await lockRows(
          tx,
          "location",
          lines.map((line) => line.locationId),
        );

        let applied = 0;
        let duplicates = 0;
        let failed = 0;
        for (const line of lines) {
          const outcome = await registerRow(tx, actor, line);
          if (outcome.kind === "done") {
            applied++;
            await tx.exitImportRow.updateMany({
              where: { id: line.id },
              data: {
                status: "DONE",
                movementId: outcome.movementId,
                appliedKey: exitKey(line.productId, line.externalId),
                appliedAt: new Date(),
              },
            });
          } else if (outcome.kind === "duplicate") {
            duplicates++;
            await tx.exitImportRow.updateMany({
              where: { id: line.id },
              data: { status: "DUPLICATE", appliedAt: new Date() },
            });
          } else {
            failed++;
            await tx.exitImportRow.updateMany({
              where: { id: line.id },
              data: {
                status: "FAILED",
                error: outcome.error.slice(0, 300),
                appliedAt: new Date(),
              },
            });
          }
        }
        await tx.exitImport.updateMany({
          where: { id: row.id },
          data: {
            status: "RUNNING",
            appliedRows: { increment: applied },
            duplicateRows: { increment: duplicates },
            failedRows: { increment: failed },
          },
        });
        return { end: null };
      },
      { ...LOCKING_TRANSACTION, timeout: 60_000, maxWait: 15_000 },
    );

    if (step.end === "not_found") return { ok: false, reason: "not_found" };
    if (step.end === "not_confirmed" || step.end === "stopped") {
      return { ok: false, reason: step.end };
    }
    if (step.end === "done") {
      return {
        ok: true,
        status: "DONE",
        applied: step.applied,
        duplicates: step.duplicates,
        failed: step.failed,
      };
    }
    await options.onBatch?.();
  }
}

const importIdOf = (payload: unknown) =>
  String((payload as { importId?: unknown } | null)?.importId ?? "");

/** Background work of the import of exits, by job type. */
export const exitImportJobHandlers: JobHandlers = {
  [EXIT_IMPORT_JOB_TYPE]: {
    handle: async (context) => {
      // The company is the one of the job, never one named in the payload.
      const outcome = await applyExitImport(
        context.organizationId,
        importIdOf(context.payload),
      );
      if (!outcome.ok && outcome.reason === "not_found") {
        throw new Error("La importación de este trabajo ya no existe.");
      }
      return outcome;
    },
    // The job will not run again: the import says so, with what is left.
    onFailed: async (context) => {
      await failExitImport(
        context.organizationId,
        importIdOf(context.payload),
        {
          message: "La importación se detuvo antes de terminar.",
          motivo: "trabajo_fallido",
        },
      );
    },
  },
};
