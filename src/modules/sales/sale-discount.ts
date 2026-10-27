import "server-only";

import { dec, type Decimal } from "@/lib";
import { can, type Subject } from "@/platform/authorization";
import type { TenantDb } from "@/server";

import type { PricedLine } from "./cart";
import { capOf, discountLines, formatPercent } from "./discounts";
import { readDiscountCaps } from "./settings";

/** A company client or one of its transactions. */
type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export type DiscountCheck = {
  /** What it takes off each line, in cents. */
  discounts: Decimal[];
  /** «5 %»: the largest the seller gives without asking. */
  cap: string;
  /** Above the seller's cap. */
  needsAuthorization: boolean;
  /** Some line ends below its average cost. */
  belowCost: boolean;
  /** The seller may sell below cost without asking. */
  mayGoBelowCost: boolean;
};

/**
 * What a discount does to the priced lines of a sale (VEN-14): how much it
 * takes off each, whether it is above the seller's cap and whether any
 * line ends below its average cost. Costs are compared here and never
 * returned: the cashier only learns that it needs a permission.
 */
export async function checkDiscount(
  client: Client,
  input: {
    organizationId: string;
    seller: Subject;
    /** «10.00». */
    percent: string;
    lines: readonly PricedLine[];
  },
): Promise<DiscountCheck> {
  const caps = await readDiscountCaps(client, input.organizationId);
  const cap = capOf(input.seller, caps);
  const discounts = discountLines(
    input.lines.map((line) => line.amount),
    input.percent,
  );
  const costs = new Map(
    (
      await client.productCost.findMany({
        where: {
          productId: { in: [...new Set(input.lines.map((l) => l.productId))] },
        },
        select: { productId: true, averageCost: true },
      })
    ).map((row) => [row.productId, dec(row.averageCost.toString())]),
  );
  const belowCost = input.lines.some((line, index) => {
    const average = costs.get(line.productId);
    if (!average || dec(input.percent).isZero()) return false;
    // What each base unit is sold at after the discount, against its cost.
    const net = line.amount.minus(discounts[index]!);
    return net.lessThan(average.times(line.baseQuantity));
  });
  return {
    discounts,
    cap: formatPercent(cap),
    needsAuthorization: dec(input.percent).greaterThan(cap),
    belowCost,
    mayGoBelowCost: can(input.seller, "sales.below_cost.authorize"),
  };
}
