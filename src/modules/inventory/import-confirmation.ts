import "server-only";

import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { reserveQuota } from "@/platform/entitlements";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { classifyImport } from "./import-classification";
import type { InventoryActor } from "./movements";

/**
 * Confirmation of an import (IMP-07). Confirming holds, in one step, the
 * places of the plan its new and reactivated products need: either all of
 * them are held or the import is not confirmed. A manual product created
 * at the same moment competes for the same counter, so together they
 * never go over the plan.
 *
 * From here on the import no longer changes; applying it — creating the
 * products in batches, each one using one of the held places — is the
 * work of the queue (IMP-08).
 */

export type ConfirmImportResult =
  | {
      ok: true;
      /** Places held now for this import. */
      reserved: number;
      /** It was already confirmed: nothing was held again. */
      repeated?: true;
    }
  | {
      ok: false;
      reason: "not_found" | "not_ready" | "no_room" | "file";
      error: string;
    };

type Failure = Extract<ConfirmImportResult, { ok: false }>;

/** Carries an expected failure out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("import not confirmed");
  }
}

const places = (n: number) => (n === 1 ? "1 lugar" : `${n} lugares`);

export async function confirmImport(
  actor: InventoryActor,
  importId: string,
): Promise<ConfirmImportResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.import.confirm",
  );
  // Read again what the file and the catalog say now. This is done before
  // the transaction (it reads a whole file); what must not be stale — the
  // room in the plan — is decided inside, by the counter itself.
  const plan = await classifyImport(actor, importId);
  if (!plan.ok) return plan;
  if (plan.validRows === 0 || plan.invalidRows > 0 || plan.conflictCount > 0) {
    return {
      ok: false,
      reason: "not_ready",
      error:
        "Esta importación todavía tiene filas por corregir. Revísala antes de confirmar.",
    };
  }
  const required = plan.quota.required;

  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      // Two confirmations of the same import go one after the other.
      const [id] = await lockRows(tx, "productImport", [plan.importId]);
      const row = id
        ? await tx.productImport.findFirst({
            where: { id },
            select: { id: true, status: true, reservedPlaces: true },
          })
        : null;
      if (!row) {
        throw new Rejected({
          ok: false,
          reason: "not_found",
          error: "Esta importación ya no existe.",
        });
      }
      if (row.status !== "READY") {
        if (row.status === "MAPPING" || row.status === "CANCELLED") {
          throw new Rejected({
            ok: false,
            reason: "not_ready",
            error:
              row.status === "CANCELLED"
                ? "Esta importación se canceló. Sube el archivo de nuevo."
                : "Primero elige las columnas de tu archivo.",
          });
        }
        // Already confirmed (a double click, a retry): once is enough.
        return {
          ok: true as const,
          reserved: row.reservedPlaces,
          repeated: true as const,
        };
      }
      if (required > 0) {
        // One conditional update on the counter: all the places or none.
        const held = await reserveQuota(
          tx,
          organizationId,
          "active_products",
          required,
        );
        if (!held.ok) {
          const free =
            held.limit === null ? 0 : Math.max(0, held.limit - held.taken);
          throw new Rejected({
            ok: false,
            reason: "no_room",
            error:
              held.limit === null
                ? "Tu empresa todavía no tiene un plan con cupo de productos."
                : `La importación necesita ${places(required)} de tu plan y ahora ${free === 1 ? "queda 1" : `quedan ${free}`}. No se importó nada: quita productos del archivo, archiva los que ya no uses o pide un nivel mayor.`,
          });
        }
      }
      await tx.productImport.updateMany({
        where: { id: row.id },
        data: {
          status: "CONFIRMED",
          reservedPlaces: required,
          confirmedAt: new Date(),
          confirmedByUserId: userId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "inventory.import_confirmed",
        target: { type: "product_import", id: row.id },
        metadata: {
          archivo: plan.fileName,
          filas: plan.validRows,
          nuevos: plan.counts.new,
          actualizados: plan.counts.update,
          reactivados: plan.counts.reactivate,
          lugaresApartados: required,
        },
      });
      return { ok: true as const, reserved: required };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}
