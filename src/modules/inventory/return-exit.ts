import "server-only";

import { dec, newId } from "@/lib";
import { lockRows, type TenantDb } from "@/server";

import { formatStock, type InventoryActor } from "./movements";
import { costPerUnit, lineCost, openCostBook } from "./valuation";

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Decimal = ReturnType<typeof dec>;

/**
 * The exit of stock of a return to the supplier (CMP-12): the movement
 * (`RETURN`), its lines and the balances, written inside the transaction
 * of the return so that the document and the stock exist together or not
 * at all. Compras calls it after checking `purchasing.return.create`:
 * returning does not need the permission of manual exits, nor grants it.
 *
 * Unlike an exit, nothing is converted with the content in force: each
 * line leaves with the factor it was received with (what entered for that
 * box is what goes back), given by the caller from the receipt line, and
 * at the cost it came in with (VAL-02, ADR 0031): the average of what stays
 * moves accordingly.
 */
export type ReturnExitLine = {
  productId: string;
  locationId: string;
  /** In the terms of the receipt line: 1 box. */
  capturedQuantity: Decimal;
  presentationId: string | null;
  presentationVersionId: string | null;
  factor: Decimal;
  unitCode: string;
  /** Cost of one captured unit (one box) it was received at; null if unknown. */
  unitCost: { toString(): string } | null;
};

export type ReturnExitResult =
  | { ok: true; movementId: string; texts: string[] }
  | {
      ok: false;
      /** Position of the line with the problem. */
      line: number;
      error: string;
    };

export async function postReturnExit(
  tx: Tx,
  actor: InventoryActor,
  input: {
    lines: ReturnExitLine[];
    /** «OC-0007 · Devolución»: what people see in the history. */
    reference: string | null;
    reason: string;
  },
): Promise<ReturnExitResult> {
  const { organizationId, userId } = actor;
  if (input.lines.length === 0) {
    throw new Error("A return needs at least one line");
  }
  // Same order as every movement: products, then locations. The caller
  // may hold them already; taking them again is harmless.
  await lockRows(
    tx,
    "product",
    input.lines.map((line) => line.productId),
  );
  await lockRows(
    tx,
    "location",
    input.lines.map((line) => line.locationId),
  );

  const lines = input.lines.map((line) => ({
    ...line,
    baseQuantity: line.capturedQuantity.times(line.factor),
  }));
  // What leaves each product in each location: `<product> <location>`.
  const taken = new Map<string, Decimal>();
  for (const line of lines) {
    const slot = `${line.productId} ${line.locationId}`;
    taken.set(slot, (taken.get(slot) ?? dec(0)).plus(line.baseQuantity));
  }
  const balances = await tx.stockBalance.findMany({
    where: {
      productId: { in: [...new Set(lines.map((line) => line.productId))] },
      locationId: { in: [...new Set(lines.map((line) => line.locationId))] },
    },
    select: { id: true, productId: true, locationId: true, quantity: true },
  });
  const current = new Map(
    balances.map((row) => [`${row.productId} ${row.locationId}`, row]),
  );
  const places = await tx.location.findMany({
    where: { id: { in: [...new Set(lines.map((line) => line.locationId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(places.map((place) => [place.id, place.name]));
  // Never below zero: what is no longer there cannot go back.
  for (const [slot, quantity] of taken) {
    const before = dec(current.get(slot)?.quantity.toString() ?? 0);
    if (before.lessThan(quantity)) {
      const index = lines.findIndex(
        (line) => `${line.productId} ${line.locationId}` === slot,
      );
      const line = lines[index]!;
      return {
        ok: false,
        line: index,
        error: `En ${nameOf.get(line.locationId) ?? "esa ubicación"} solo hay ${formatStock(before.toString(), line.unitCode)}. Lo que ya salió o se movió de ahí no se puede devolver desde ahí.`,
      };
    }
  }

  // Read before any balance changes: the stock all locations had.
  const costs = await openCostBook(
    tx,
    organizationId,
    lines.map((line) => line.productId),
  );
  const unitCosts = lines.map((line) =>
    costs.exitAt(
      line.productId,
      line.baseQuantity,
      costPerUnit(line.unitCost?.toString(), line.factor),
    ),
  );

  const movementId = newId();
  await tx.stockMovement.create({
    data: {
      id: movementId,
      organizationId,
      type: "RETURN",
      reason: input.reason,
      reference: input.reference,
      createdByUserId: userId,
    },
  });
  await tx.stockMovementLine.createMany({
    data: lines.map((line, index) => ({
      id: newId(),
      organizationId,
      movementId,
      lineNumber: index + 1,
      productId: line.productId,
      locationId: line.locationId,
      direction: "OUT" as const,
      capturedQuantity: line.capturedQuantity.toString(),
      presentationId: line.presentationId,
      presentationVersionId: line.presentationVersionId,
      factor: line.factor.toString(),
      baseQuantity: line.baseQuantity.toString(),
      unitCode: line.unitCode,
      unitCost: lineCost(unitCosts[index]!),
    })),
  });
  await costs.save();
  for (const [slot, quantity] of taken) {
    const row = current.get(slot)!;
    // Conditioned like every exit; the CHECK of the table is the last line.
    const updated = await tx.stockBalance.updateMany({
      where: { id: row.id, quantity: { gte: quantity.toString() } },
      data: { quantity: { decrement: quantity.toString() } },
    });
    if (updated.count !== 1) {
      throw new Error(`Balance changed under its lock: ${slot}`);
    }
  }
  return {
    ok: true,
    movementId,
    texts: lines.map((line) =>
      formatStock(line.baseQuantity.toString(), line.unitCode),
    ),
  };
}
