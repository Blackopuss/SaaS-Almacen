import "server-only";

import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { releaseReservation } from "@/platform/entitlements";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import type { InventoryActor } from "./movements";

/**
 * Giving back the places an import was holding and did not use (IMP-08B).
 * An import stops before finishing in two ways: a person cancels it, or
 * its job fails for good (it ran out of attempts, or its worker
 * disappeared). Either way the products already applied stay, and only
 * the places still held go back to the plan.
 *
 * Everything here happens with the row of the import locked — the same
 * lock each batch of the worker takes — so a batch in progress finishes
 * first, what is given back is what it left, and the next batch finds the
 * import stopped and does nothing.
 */

export const IMPORT_JOB_TYPE = "inventory.import_products";

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

type HeldImport = {
  id: string;
  reservedPlaces: number;
  totalItems: number;
  processedItems: number;
  failedItems: number;
};

/**
 * Closes an import that will not go on: its held places go back and it
 * keeps what it had done. Call it with the row of the import locked and
 * read under that lock.
 */
async function closeImport(
  tx: Tx,
  row: HeldImport,
  end: { status: "CANCELLED" | "FAILED"; lastError: string | null },
): Promise<{ released: number }> {
  const released = row.reservedPlaces;
  if (released > 0) {
    const returned = await releaseReservation(tx, "active_products", released);
    if (!returned) {
      // The counter holds fewer places than this import says it has: a
      // defect to look into. Nothing is taken from what others hold.
      console.error(
        `[imports] la importación ${row.id} tenía ${released} lugares apartados que el contador ya no tiene.`,
      );
    }
  }
  await tx.productImport.updateMany({
    where: { id: row.id },
    data: {
      status: end.status,
      reservedPlaces: 0,
      finishedAt: new Date(),
      lastError: end.lastError,
    },
  });
  return { released };
}

const HELD = {
  id: true,
  status: true,
  reservedPlaces: true,
  totalItems: true,
  processedItems: true,
  failedItems: true,
  file: { select: { name: true } },
} as const;

export type CancelImportResult =
  | {
      ok: true;
      /** Places that went back to the plan now. */
      released: number;
      /** Products that were already in the catalog and stay. */
      applied: number;
      /** Products of the file that will not be imported. */
      pending: number;
      /** It was already cancelled: nothing changed again. */
      repeated?: true;
    }
  | { ok: false; reason: "not_found" | "finished"; error: string };

type Failure = Extract<CancelImportResult, { ok: false }>;

/** Carries an expected failure out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("import not cancelled");
  }
}

/**
 * Cancels an import of the company, before or while the worker applies
 * it. What was already applied is not undone; the places it still held
 * go back to the plan. Cancelling twice gives back once.
 */
export async function cancelImport(
  actor: InventoryActor,
  importId: string,
): Promise<CancelImportResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.import.cancel",
  );
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      // The batch the worker has in hand ends first.
      const [id] = await lockRows(tx, "productImport", [
        String(importId).slice(0, 36),
      ]);
      const row = id
        ? await tx.productImport.findFirst({ where: { id }, select: HELD })
        : null;
      if (!row) {
        throw new Rejected({
          ok: false,
          reason: "not_found",
          error: "Esta importación ya no existe.",
        });
      }
      const applied = row.processedItems - row.failedItems;
      const pending = row.totalItems - row.processedItems;
      if (row.status === "CANCELLED") {
        return {
          ok: true as const,
          released: 0,
          applied,
          pending,
          repeated: true as const,
        };
      }
      if (row.status === "DONE" || row.status === "FAILED") {
        throw new Rejected({
          ok: false,
          reason: "finished",
          error:
            row.status === "DONE"
              ? "Esta importación ya terminó: no queda nada por cancelar."
              : "Esta importación ya se detuvo y sus lugares volvieron a tu plan.",
        });
      }
      const { released } = await closeImport(tx, row, {
        status: "CANCELLED",
        lastError: null,
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "inventory.import_cancelled",
        target: { type: "product_import", id: row.id },
        metadata: {
          archivo: row.file.name,
          productosImportados: applied,
          sinImportar: pending,
          lugaresDevueltos: released,
        },
      });
      return { ok: true as const, released, applied, pending };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

const notImported = (pending: number) =>
  pending === 1
    ? "Falta 1 producto por importar"
    : `Faltan ${pending.toLocaleString("es-MX")} productos por importar`;

/**
 * Ends an import that could not go on as failed: places back, reason for
 * people, and a line in the audit trail. With the row locked, like
 * `closeImport`.
 */
async function failImport(
  tx: Tx,
  organizationId: string,
  row: HeldImport & { file: { name: string } },
  why: { message: string; motivo: string },
): Promise<{ released: number }> {
  const pending = row.totalItems - row.processedItems;
  const { released } = await closeImport(tx, row, {
    status: "FAILED",
    lastError: `${why.message} ${notImported(pending)}: sube de nuevo el archivo para importarlos.`,
  });
  await recordAuditEvent(tx, {
    organizationId,
    // Nobody did this: the system stopped it.
    actorUserId: null,
    action: "inventory.import_failed",
    target: { type: "product_import", id: row.id },
    metadata: {
      archivo: row.file.name,
      motivo: why.motivo,
      productosImportados: row.processedItems - row.failedItems,
      sinImportar: pending,
      lugaresDevueltos: released,
    },
  });
  return { released };
}

/**
 * Whoever confirmed the import may no longer import (their access
 * changed, or the plan of the company no longer allows writing): what is
 * pending is not applied in their name. The import ends as failed, keeps
 * what it had done and gives back the places it still held. Returns false
 * when it had already ended.
 */
export async function stopUnauthorizedImport(
  organizationId: string,
  importId: string,
): Promise<boolean> {
  return forOrganization(organizationId).$transaction(async (tx) => {
    const [id] = await lockRows(tx, "productImport", [
      String(importId).slice(0, 36),
    ]);
    const row = id
      ? await tx.productImport.findFirst({ where: { id }, select: HELD })
      : null;
    if (!row || (row.status !== "CONFIRMED" && row.status !== "RUNNING")) {
      return false;
    }
    await failImport(tx, organizationId, row, {
      message:
        "La importación se detuvo: quien la confirmó ya no puede importar productos en esta empresa.",
      motivo: "sin_permiso",
    });
    return true;
  }, LOCKING_TRANSACTION);
}

export type ReleaseFailedImportOutcome =
  | { released: number }
  /** Nothing to do: it had ended, or other work will go on with it. */
  | {
      released: null;
      reason: "not_found" | "ended" | "job_not_failed" | "active_job";
    };

/**
 * The job of an import ended for good without finishing it: the import
 * is marked as failed and the places it still held go back to the plan.
 * It can be called any number of times; only the first one finds
 * something to give back.
 */
export async function releaseFailedImport(
  organizationId: string,
  importId: string,
  failedJobId: string,
): Promise<ReleaseFailedImportOutcome> {
  return forOrganization(organizationId).$transaction(async (tx) => {
    const [id] = await lockRows(tx, "productImport", [
      String(importId).slice(0, 36),
    ]);
    const row = id
      ? await tx.productImport.findFirst({ where: { id }, select: HELD })
      : null;
    if (!row) return { released: null, reason: "not_found" as const };
    if (row.status !== "CONFIRMED" && row.status !== "RUNNING") {
      return { released: null, reason: "ended" as const };
    }
    // Only a job of this import that really ended as failed lets go of
    // its places: the id alone proves nothing.
    const failed = await tx.job.count({
      where: {
        id: String(failedJobId).slice(0, 36),
        type: IMPORT_JOB_TYPE,
        status: "FAILED",
        payload: { path: "$.importId", equals: row.id },
      },
    });
    if (failed !== 1) {
      return { released: null, reason: "job_not_failed" as const };
    }
    // Never compete with work that is alive: if another job of this
    // import is waiting or running, the places are still its own.
    const active = await tx.job.count({
      where: {
        type: IMPORT_JOB_TYPE,
        id: { not: failedJobId },
        status: { in: ["PENDING", "RUNNING"] },
        payload: { path: "$.importId", equals: row.id },
      },
    });
    if (active > 0) return { released: null, reason: "active_job" as const };

    return failImport(tx, organizationId, row, {
      message: "La importación se detuvo antes de terminar.",
      motivo: "trabajo_fallido",
    });
  }, LOCKING_TRANSACTION);
}
