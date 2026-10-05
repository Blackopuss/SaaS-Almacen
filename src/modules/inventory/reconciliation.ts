import "server-only";

import { dec } from "@/lib";
import { forOrganization } from "@/server";

/**
 * The balance of a product in a location is a projection of its movement
 * lines: everything that came in minus everything that went out (INV-15).
 * This check recomputes that sum and reports where the stored balance
 * differs. It must always come back empty; tests use it after every kind of
 * movement and after concurrent ones.
 */

export type StockDrift = {
  productId: string;
  locationId: string;
  /** What the movement lines add up to. */
  fromMovements: string;
  /** What the balance row says ("0" when there is no row). */
  balance: string;
};

/** Differences between balances and movement history; empty when they agree. */
export async function reconcileStock(
  organizationId: string,
): Promise<StockDrift[]> {
  const client = forOrganization(organizationId);
  const [sums, balances] = await Promise.all([
    client.stockMovementLine.groupBy({
      by: ["productId", "locationId", "direction"],
      _sum: { baseQuantity: true },
    }),
    client.stockBalance.findMany({
      select: { productId: true, locationId: true, quantity: true },
    }),
  ]);

  const key = (row: { productId: string; locationId: string }) =>
    `${row.productId}|${row.locationId}`;
  const expected = new Map<string, ReturnType<typeof dec>>();
  for (const sum of sums) {
    const amount = dec((sum._sum.baseQuantity ?? 0).toString());
    const current = expected.get(key(sum)) ?? dec(0);
    expected.set(
      key(sum),
      sum.direction === "IN" ? current.plus(amount) : current.minus(amount),
    );
  }
  const stored = new Map(
    balances.map((row) => [key(row), dec(row.quantity.toString())]),
  );

  const drift: StockDrift[] = [];
  for (const id of new Set([...expected.keys(), ...stored.keys()])) {
    const fromMovements = expected.get(id) ?? dec(0);
    const balance = stored.get(id) ?? dec(0);
    if (!fromMovements.equals(balance)) {
      const [productId = "", locationId = ""] = id.split("|");
      drift.push({
        productId,
        locationId,
        fromMovements: fromMovements.toString(),
        balance: balance.toString(),
      });
    }
  }
  return drift;
}

export type ReconciliationReport = {
  organizationId: string;
  /** Product–location pairs that were compared. */
  pairs: number;
  /** Differences found, named so a person can go and look. */
  drift: (StockDrift & {
    sku: string;
    productName: string;
    locationName: string;
    /** balance − fromMovements: what the balance has too much (or too little). */
    difference: string;
  })[];
};

/**
 * Reconciliation of one company (INV-34): compares every balance with its
 * movement history and names what differs. It only reads — a difference
 * is a defect to investigate, never something to repair silently.
 */
export async function reconcileCompany(
  organizationId: string,
): Promise<ReconciliationReport> {
  const client = forOrganization(organizationId);
  const [drift, pairs] = await Promise.all([
    reconcileStock(organizationId),
    client.stockBalance.count(),
  ]);
  if (drift.length === 0) return { organizationId, pairs, drift: [] };

  const shown = drift.slice(0, 500);
  const [products, locations] = await Promise.all([
    client.product.findMany({
      where: { id: { in: [...new Set(shown.map((row) => row.productId))] } },
      select: { id: true, sku: true, name: true },
    }),
    client.location.findMany({
      where: { id: { in: [...new Set(shown.map((row) => row.locationId))] } },
      select: { id: true, name: true },
    }),
  ]);
  const productOf = new Map(products.map((product) => [product.id, product]));
  const locationOf = new Map(
    locations.map((location) => [location.id, location.name]),
  );
  return {
    organizationId,
    pairs,
    drift: shown.map((row) => ({
      ...row,
      sku: productOf.get(row.productId)?.sku ?? "?",
      productName: productOf.get(row.productId)?.name ?? "?",
      locationName: locationOf.get(row.locationId) ?? "?",
      difference: dec(row.balance).minus(row.fromMovements).toString(),
    })),
  };
}
