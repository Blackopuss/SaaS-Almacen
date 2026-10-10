import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { applyImportedProduct } from "@/platform/catalog";
import { releaseReservation } from "@/platform/entitlements";
import type { JobHandlers } from "@/platform/jobs";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

/**
 * Applying a confirmed import, in the worker (IMP-08). The products were
 * fixed as items when the import was confirmed; this goes through the
 * pending ones in batches, each batch in one transaction: the products of
 * the batch and their marks are written together or not at all.
 *
 * The job may run twice (a worker that died, a retry): an item already
 * marked is never taken again, so running again continues where it
 * stopped and never repeats a product.
 */

export const IMPORT_JOB_TYPE = "inventory.import_products";

/** What an item keeps of its product, fixed at confirmation. */
export type ImportItemData = {
  /** Row of the file the product comes from. */
  row: number;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  barcode: string | null;
  unitCode: string;
  presentation: { name: string; content: string } | null;
  minimum: string | null;
  /** Initial stock by location, already in the product's unit (IMP-09). */
  stock: {
    row: number;
    base: string;
    captured: string;
    inPresentation: boolean;
    locationId: string;
  }[];
};

/** Products applied per transaction. */
const BATCH = 50;

export type ApplyImportOutcome =
  | { ok: true; status: "DONE"; processed: number; failed: number }
  | { ok: false; reason: "not_found" | "not_confirmed" };

/**
 * Applies what is pending of an import. Returns when nothing is left;
 * throws on anything unexpected, so the queue tries again later.
 */
export async function applyImport(
  organizationId: string,
  importId: string,
  options: { batchSize?: number; onBatch?: () => Promise<void> | void } = {},
): Promise<ApplyImportOutcome> {
  const client = forOrganization(organizationId);
  const batchSize = Math.min(Math.max(options.batchSize ?? BATCH, 1), 200);

  for (;;) {
    const step = await client.$transaction(
      async (tx) => {
        // Cancelling or another worker cannot slip in between.
        const [id] = await lockRows(tx, "productImport", [importId]);
        const row = id
          ? await tx.productImport.findFirst({
              where: { id },
              select: {
                id: true,
                status: true,
                reservedPlaces: true,
                confirmedByUserId: true,
                createdByUserId: true,
                totalItems: true,
                processedItems: true,
                failedItems: true,
                file: { select: { name: true } },
              },
            })
          : null;
        if (!row) return { end: "not_found" as const };
        if (row.status === "DONE") {
          return {
            end: "done" as const,
            processed: row.processedItems,
            failed: row.failedItems,
          };
        }
        if (row.status !== "CONFIRMED" && row.status !== "RUNNING") {
          return { end: "not_confirmed" as const };
        }
        const actor = {
          organizationId,
          userId: row.confirmedByUserId ?? row.createdByUserId,
        };
        const items = await tx.productImportItem.findMany({
          where: { importId: row.id, status: "PENDING" },
          orderBy: { position: "asc" },
          take: batchSize,
          select: { id: true, sku: true, data: true },
        });

        if (items.length === 0) {
          // Nothing left: places that were held and not needed go back.
          if (row.reservedPlaces > 0) {
            await releaseReservation(tx, "active_products", row.reservedPlaces);
          }
          await tx.productImport.updateMany({
            where: { id: row.id },
            data: {
              status: "DONE",
              reservedPlaces: 0,
              finishedAt: new Date(),
              lastError: null,
            },
          });
          await recordAuditEvent(tx, {
            organizationId,
            actorUserId: actor.userId,
            action: "inventory.import_applied",
            target: { type: "product_import", id: row.id },
            metadata: {
              archivo: row.file.name,
              productos: row.processedItems - row.failedItems,
              conProblemas: row.failedItems,
              lugaresDevueltos: row.reservedPlaces,
            },
          });
          return {
            end: "done" as const,
            processed: row.processedItems,
            failed: row.failedItems,
          };
        }

        let reserved = row.reservedPlaces;
        let failed = 0;
        for (const item of items) {
          const data = item.data as ImportItemData;
          const applied = await applyImportedProduct(
            tx,
            actor,
            {
              sku: item.sku,
              name: data.name,
              description: data.description,
              category: data.category,
              brand: data.brand,
              barcode: data.barcode,
              unitCode: data.unitCode,
              presentation: data.presentation,
            },
            { hasReservation: reserved > 0 },
          );
          if (!applied.ok) {
            failed++;
            await tx.productImportItem.updateMany({
              where: { id: item.id },
              data: {
                status: "FAILED",
                error: applied.error.slice(0, 300),
                appliedAt: new Date(),
              },
            });
            continue;
          }
          if (applied.usedReservation) reserved--;
          if (data.minimum) {
            const changed = await tx.stockMinimum.updateMany({
              where: { productId: applied.productId },
              data: { quantity: data.minimum, updatedByUserId: actor.userId },
            });
            if (changed.count === 0) {
              await tx.stockMinimum.create({
                data: {
                  id: newId(),
                  organizationId,
                  productId: applied.productId,
                  quantity: data.minimum,
                  updatedByUserId: actor.userId,
                },
              });
            }
          }
          await tx.productImportItem.updateMany({
            where: { id: item.id },
            data: {
              status: "DONE",
              productId: applied.productId,
              appliedAt: new Date(),
            },
          });
        }
        await tx.productImport.updateMany({
          where: { id: row.id },
          data: {
            status: "RUNNING",
            reservedPlaces: reserved,
            processedItems: { increment: items.length },
            failedItems: { increment: failed },
          },
        });
        return { end: null };
      },
      { ...LOCKING_TRANSACTION, timeout: 60_000, maxWait: 15_000 },
    );

    if (step.end === "not_found") return { ok: false, reason: "not_found" };
    if (step.end === "not_confirmed") {
      return { ok: false, reason: "not_confirmed" };
    }
    if (step.end === "done") {
      return {
        ok: true,
        status: "DONE",
        processed: step.processed,
        failed: step.failed,
      };
    }
    await options.onBatch?.();
  }
}

/** Background work of Inventario, by job type (see modules/registry/jobs). */
export const inventoryJobHandlers: JobHandlers = {
  [IMPORT_JOB_TYPE]: {
    handle: async (context) => {
      const importId = String(
        (context.payload as { importId?: unknown } | null)?.importId ?? "",
      );
      // The company is the one of the job, never one named in the payload.
      const outcome = await applyImport(context.organizationId, importId);
      if (!outcome.ok && outcome.reason === "not_found") {
        throw new Error("La importación de este trabajo ya no existe.");
      }
      return outcome;
    },
  },
};
