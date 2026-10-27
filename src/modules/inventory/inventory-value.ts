import "server-only";

import { Decimal, dec, formatDecimal, isAppError } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

import type { InventoryActor } from "./movements";

/**
 * What the inventory is worth at cost (VAL-05, ADR 0031), only for who
 * may see costs (`inventory.cost.read`). Kept apart from the stock
 * services: for everybody else these answers do not exist, not even empty.
 */

/** «$1,250.00»; prices under a peso keep up to 4 decimals: «$0.0125». */
export function formatCost(amount: { toString(): string } | string): string {
  const value = dec(amount.toString()).toDecimalPlaces(
    4,
    Decimal.ROUND_HALF_UP,
  );
  return `$${formatDecimal(value, { minScale: 2 })}`;
}

/** «$1,250.00»: a value, always with cents. */
export const formatValue = (amount: { toString(): string } | string) =>
  `$${formatDecimal(
    dec(amount.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    { minScale: 2, maxScale: 2 },
  )}`;

/** Whether the person may see costs: never an error, just yes or no. */
export async function mayReadInventoryCosts(
  actor: InventoryActor,
): Promise<boolean> {
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "inventory.cost.read",
    );
    return true;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return false;
    throw error;
  }
}

export type ProductCostView = {
  /** «$85.50» per unit of the product. */
  averageCost: string;
  /** «$855.00» for all its stock. */
  stockValue: string;
};

/** Average cost and value of one product; null while its cost is unknown. */
export async function getProductCost(
  actor: InventoryActor,
  productId: string,
): Promise<ProductCostView | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.cost.read",
  );
  const row = await forOrganization(actor.organizationId).productCost.findFirst(
    {
      where: { productId: String(productId).slice(0, 36) },
      select: { averageCost: true, stockValue: true },
    },
  );
  return row
    ? {
        averageCost: formatCost(row.averageCost),
        stockValue: formatValue(row.stockValue),
      }
    : null;
}

export type InventoryValue = {
  /** «$48,250.00»: every product, every location, at average cost. */
  total: string;
  /** Products with stock whose cost nobody has given yet. */
  withoutCost: number;
};

/** What all the stock of the company is worth at cost. */
export async function getInventoryValue(
  actor: InventoryActor,
): Promise<InventoryValue> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.cost.read",
  );
  const client = forOrganization(actor.organizationId);
  const [sum, costed, stocked] = await Promise.all([
    client.productCost.aggregate({ _sum: { stockValue: true } }),
    client.productCost.findMany({ select: { productId: true } }),
    client.stockBalance.groupBy({
      by: ["productId"],
      where: { quantity: { gt: 0 } },
    }),
  ]);
  const known = new Set(costed.map((row) => row.productId));
  return {
    total: formatValue(sum._sum.stockValue ?? "0"),
    withoutCost: stocked.filter((row) => !known.has(row.productId)).length,
  };
}
