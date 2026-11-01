import "server-only";

import { dec, newId } from "@/lib";
import { lockRows, type TenantDb } from "@/server";

import { formatStock, type InventoryActor } from "./movements";
import { lineCost, openCostBook } from "./valuation";

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Decimal = ReturnType<typeof dec>;

/**
 * The exit of stock of a counter sale (VEN-09, ADR 0030): the movement
 * (`SALE`), its lines and the balances, written inside the transaction of
 * the sale so that the ticket and the stock exist together or not at all.
 * Ventas calls it after checking `sales.sale.create` and converting each
 * line with the content in force; selling does not need the permission of
 * manual exits, nor grants it. Each line leaves at the average cost
 * (VAL-04), which comes back so the sale can show its profit.
 */
export type SaleExitLine = {
  productId: string;
  locationId: string;
  /** As sold: 1 box, 2.75 m. */
  capturedQuantity: Decimal;
  presentationId: string | null;
  presentationVersionId: string | null;
  factor: Decimal;
  unitCode: string;
};

export type SaleExitResult =
  | {
      ok: true;
      movementId: string;
      /** Average cost of one unit each line took; null when unknown. */
      unitCosts: (string | null)[];
    }
  | {
      ok: false;
      /** Position of the line with the problem. */
      line: number;
      error: string;
    };

export async function postSaleExit(
  tx: Tx,
  actor: InventoryActor,
  input: {
    lines: SaleExitLine[];
    /** «Venta 12»: what people see in the history. */
    reference: string;
    productNames: Map<string, string>;
  },
): Promise<SaleExitResult> {
  const { organizationId, userId } = actor;
  if (input.lines.length === 0) {
    throw new Error("A sale needs at least one line");
  }
  // Same order as every movement: products, then locations. The caller
  // holds the products already; taking them again is harmless.
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
  const places = new Map(
    (
      await tx.location.findMany({
        where: { id: { in: [...new Set(lines.map((l) => l.locationId))] } },
        select: { id: true, name: true, archivedAt: true },
      })
    ).map((place) => [place.id, place]),
  );
  for (const [index, line] of lines.entries()) {
    const place = places.get(line.locationId);
    if (!place) {
      return { ok: false, line: index, error: "Esa ubicación ya no existe." };
    }
    if (place.archivedAt) {
      return {
        ok: false,
        line: index,
        error: `«${place.name}» está archivada. Elige otra ubicación.`,
      };
    }
  }

  // The same product may come in several lines (a box and loose pieces):
  // together they never take more than the location holds.
  const slot = (line: { productId: string; locationId: string }) =>
    `${line.productId}|${line.locationId}`;
  const balances = await tx.stockBalance.findMany({
    where: {
      OR: [...new Set(lines.map(slot))].map((key) => {
        const [productId, locationId] = key.split("|");
        return { productId, locationId };
      }),
    },
    select: { id: true, productId: true, locationId: true, quantity: true },
  });
  const balanceOf = new Map(balances.map((row) => [slot(row), row]));
  const taken = new Map<string, Decimal>();
  for (const [index, line] of lines.entries()) {
    const key = slot(line);
    const held = dec(balanceOf.get(key)?.quantity.toString() ?? 0);
    const after = (taken.get(key) ?? dec(0)).plus(line.baseQuantity);
    if (after.greaterThan(held)) {
      const name = input.productNames.get(line.productId) ?? "este producto";
      const where = places.get(line.locationId)!.name;
      return {
        ok: false,
        line: index,
        error: held.isZero()
          ? `Ya no hay ${name} en ${where}.`
          : `Solo hay ${formatStock(held.toString(), line.unitCode)} de ${name} en ${where}.`,
      };
    }
    taken.set(key, after);
  }

  // Read before any balance changes: the stock all locations had.
  const costs = await openCostBook(
    tx,
    organizationId,
    lines.map((line) => line.productId),
  );
  const unitCosts = lines.map((line) =>
    lineCost(costs.exit(line.productId, line.baseQuantity)),
  );

  const movementId = newId();
  await tx.stockMovement.create({
    data: {
      id: movementId,
      organizationId,
      type: "SALE",
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
      unitCost: unitCosts[index]!,
    })),
  });
  await costs.save();
  for (const [key, quantity] of taken) {
    // Conditioned like every exit; the CHECK of the table is the last line.
    const updated = await tx.stockBalance.updateMany({
      where: {
        id: balanceOf.get(key)?.id ?? "",
        quantity: { gte: quantity.toString() },
      },
      data: { quantity: { decrement: quantity.toString() } },
    });
    if (updated.count !== 1) {
      throw new Error(`Balance changed under its lock: ${key}`);
    }
  }
  return { ok: true, movementId, unitCosts };
}
