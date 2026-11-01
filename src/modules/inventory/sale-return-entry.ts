import "server-only";

import { dec, newId } from "@/lib";
import { lockRows, type TenantDb } from "@/server";

import { MAX_BALANCE, formatStock, type InventoryActor } from "./movements";
import { lineCost, openCostBook } from "./valuation";

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Decimal = ReturnType<typeof dec>;

/**
 * The stock entry of goods that came back from a sale (VEN-19, ADR 0030):
 * the movement (`SALE_RETURN`), its lines and the balances, inside the
 * transaction of the return. Ventas calls it after checking its own
 * permission. Each line comes back with the factor and the cost it left
 * with (VAL: a return enters at the cost it left with), to the location it
 * left from — or to «General» if that one was archived since.
 */
export type SaleReturnEntryLine = {
  productId: string;
  locationId: string;
  capturedQuantity: Decimal;
  presentationId: string | null;
  presentationVersionId: string | null;
  factor: Decimal;
  unitCode: string;
  /** Average cost of one unit it left with; null when unknown. */
  unitCost: { toString(): string } | null;
};

export type SaleReturnEntryResult =
  | {
      ok: true;
      movementId: string;
      /** Where each line went back to. */
      locationIds: string[];
    }
  | { ok: false; line: number; error: string };

export async function postSaleReturnEntry(
  tx: Tx,
  actor: InventoryActor,
  input: { lines: SaleReturnEntryLine[]; reference: string; reason: string },
): Promise<SaleReturnEntryResult> {
  const { organizationId, userId } = actor;
  if (input.lines.length === 0) {
    throw new Error("A return needs at least one line");
  }
  await lockRows(
    tx,
    "product",
    input.lines.map((line) => line.productId),
  );
  const places = new Map(
    (
      await tx.location.findMany({
        where: {
          id: { in: [...new Set(input.lines.map((l) => l.locationId))] },
        },
        select: { id: true, archivedAt: true },
      })
    ).map((place) => [place.id, place]),
  );
  const general = await tx.location.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  const lines = input.lines.map((line) => {
    const place = places.get(line.locationId);
    return {
      ...line,
      locationId:
        place && !place.archivedAt ? line.locationId : (general?.id ?? ""),
      baseQuantity: line.capturedQuantity.times(line.factor),
    };
  });
  await lockRows(
    tx,
    "location",
    lines.map((line) => line.locationId),
  );

  const slot = (line: { productId: string; locationId: string }) =>
    `${line.productId}|${line.locationId}`;
  const added = new Map<string, Decimal>();
  for (const line of lines) {
    const key = slot(line);
    added.set(key, (added.get(key) ?? dec(0)).plus(line.baseQuantity));
  }
  const balances = await tx.stockBalance.findMany({
    where: {
      OR: [...added.keys()].map((key) => {
        const [productId, locationId] = key.split("|");
        return { productId, locationId };
      }),
    },
    select: { id: true, productId: true, locationId: true, quantity: true },
  });
  const current = new Map(balances.map((row) => [slot(row), row]));
  for (const [key, quantity] of added) {
    const before = dec(current.get(key)?.quantity.toString() ?? 0);
    if (before.plus(quantity).greaterThan(MAX_BALANCE)) {
      const index = lines.findIndex((line) => slot(line) === key);
      return {
        ok: false,
        line: index,
        error: `Con esta devolución habría más de ${formatStock(MAX_BALANCE.toString(), lines[index]!.unitCode)} en esa ubicación.`,
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
    costs.entry(
      line.productId,
      line.baseQuantity,
      line.unitCost === null ? null : line.unitCost.toString(),
    ),
  );

  const movementId = newId();
  await tx.stockMovement.create({
    data: {
      id: movementId,
      organizationId,
      type: "SALE_RETURN",
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
      direction: "IN" as const,
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
  for (const [key, quantity] of added) {
    const row = current.get(key);
    if (row) {
      await tx.stockBalance.updateMany({
        where: { id: row.id },
        data: { quantity: { increment: quantity.toString() } },
      });
    } else {
      const [productId, locationId] = key.split("|");
      await tx.stockBalance.create({
        data: {
          id: newId(),
          organizationId,
          productId: productId!,
          locationId: locationId!,
          quantity: quantity.toString(),
        },
      });
    }
  }
  return {
    ok: true,
    movementId,
    locationIds: lines.map((line) => line.locationId),
  };
}
