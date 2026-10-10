import "server-only";

import { dec, newId } from "@/lib";
import { parseQuantity } from "@/platform/catalog";
import type { TenantDb } from "@/server";

/**
 * Initial stock that comes in the file of an import (IMP-09). Each row
 * with stock becomes an `INITIAL` movement with its line and its balance,
 * like a balance captured by hand (INV-18) and with the same two rules:
 * it comes before any other movement of the product, and each location
 * gets it once.
 *
 * Quantities are the ones fixed when the import was confirmed — what was
 * written, the content of the presentation and the result in the
 * product's unit — so a presentation changed while the import runs does
 * not change what enters. Both functions run inside the transaction of
 * the batch, with the product and its locations already locked; nothing
 * here opens another connection.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export type ImportedStockLine = {
  /** Row of the file. */
  row: number;
  /** Quantity in the product's unit. */
  base: string;
  /** As written in the file. */
  captured: string;
  /** Written in the presentation of the row, not in the unit. */
  inPresentation: boolean;
  locationId: string;
};

/** Largest quantity a movement line keeps, captured or in the unit. */
const MAX_BALANCE = "999999999.999";

/**
 * Says why the stock of a product of the file can no longer enter as
 * initial, or null when it can. It writes nothing, and is asked before
 * the product itself is touched: a product whose stock cannot enter is
 * left as it was, whole.
 */
export async function checkImportedStock(
  tx: Tx,
  product: { id: string; unitCode: string; quantityStep: string } | null,
  lines: readonly ImportedStockLine[],
  hasPresentation: boolean,
): Promise<string | null> {
  if (lines.length === 0) return null;
  const ids = [...new Set(lines.map((line) => line.locationId))];
  if (ids.length !== lines.length) {
    return "El archivo da dos existencias para la misma ubicación.";
  }
  if (lines.some((line) => line.inPresentation) && !hasPresentation) {
    return "La existencia viene en una presentación que la fila no tiene.";
  }
  const locations = await tx.location.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, archivedAt: true },
  });
  const byId = new Map(locations.map((location) => [location.id, location]));
  for (const line of lines) {
    const location = byId.get(line.locationId);
    if (!location) {
      return `La ubicación de la fila ${line.row} ya no existe.`;
    }
    if (location.archivedAt) {
      return `«${location.name}» se archivó después de confirmar: su existencia (fila ${line.row}) ya no puede entrar ahí.`;
    }
    if (
      !dec(line.base).isPositive() ||
      dec(line.base).greaterThan(MAX_BALANCE) ||
      !dec(line.captured).isPositive() ||
      dec(line.captured).greaterThan(MAX_BALANCE)
    ) {
      return `La existencia de la fila ${line.row} no es una cantidad válida.`;
    }
  }
  if (!product) return null;

  // The product is locked: what is read here cannot change under us.
  const moved = await tx.stockMovementLine.findFirst({
    where: { productId: product.id, movement: { type: { not: "INITIAL" } } },
    select: { id: true },
  });
  if (moved) {
    return "El producto ya tiene movimientos: su existencia ya no es «inicial». Corrige la cantidad con un ajuste o un conteo.";
  }
  // Only initial balances are left: one per location, at most.
  const counted = await tx.stockMovementLine.findFirst({
    where: { productId: product.id, locationId: { in: ids } },
    select: { locationId: true },
  });
  if (counted) {
    const taken = lines.find((line) => line.locationId === counted.locationId)!;
    return `El producto ya tiene saldo inicial en «${byId.get(taken.locationId)!.name}» (fila ${taken.row}).`;
  }
  // The file was read with the rule a new product of that unit gets; a
  // product that exists may measure in other steps.
  for (const line of lines) {
    const parsed = parseQuantity(
      { unitCode: product.unitCode, quantityStep: product.quantityStep },
      line.base,
    );
    if (!parsed.ok) {
      return `Existencia de la fila ${line.row}: ${parsed.error}`;
    }
  }
  return null;
}

/**
 * Writes the initial stock of a product of the file: one movement, one
 * line and the balance per location. Call it only after
 * `checkImportedStock` said it can enter, in the same transaction that
 * marks the item as applied — that mark is what keeps a retry from
 * writing it twice, and the key of each movement is the second guard.
 */
export async function postImportedStock(
  tx: Tx,
  actor: { organizationId: string; userId: string },
  input: {
    /** Item of the import: with the line number, the key of each movement. */
    itemId: string;
    product: { id: string; unitCode: string };
    /** Presentation of the row and the version with the confirmed content. */
    presentation: { id: string; versionId: string; content: string } | null;
    lines: readonly ImportedStockLine[];
  },
): Promise<{ movements: number }> {
  const { organizationId, userId } = actor;
  const { product, presentation } = input;
  let number = 0;
  for (const line of input.lines) {
    number++;
    const inPresentation = line.inPresentation && presentation !== null;
    const movementId = newId();
    await tx.stockMovement.create({
      data: {
        id: movementId,
        organizationId,
        type: "INITIAL",
        reference: `Importación, fila ${line.row}`,
        idempotencyKey: `import:${input.itemId}:${number}`,
        createdByUserId: userId,
      },
    });
    await tx.stockMovementLine.create({
      data: {
        id: newId(),
        organizationId,
        movementId,
        lineNumber: 1,
        productId: product.id,
        locationId: line.locationId,
        direction: "IN",
        // What the file said, with the content it was confirmed with.
        capturedQuantity: inPresentation
          ? dec(line.captured).toString()
          : line.base,
        capturedUnitCode: null,
        presentationId: inPresentation ? presentation.id : null,
        presentationVersionId: inPresentation ? presentation.versionId : null,
        factor: inPresentation ? presentation.content : "1",
        baseQuantity: line.base,
        unitCode: product.unitCode,
      },
    });
    const added = await tx.stockBalance.updateMany({
      where: { productId: product.id, locationId: line.locationId },
      data: { quantity: { increment: line.base } },
    });
    if (added.count === 0) {
      await tx.stockBalance.create({
        data: {
          id: newId(),
          organizationId,
          productId: product.id,
          locationId: line.locationId,
          quantity: line.base,
        },
      });
    }
  }
  return { movements: number };
}
