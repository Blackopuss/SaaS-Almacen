import "server-only";

import { dec } from "@/lib";
import {
  ADD_ON_CHOICES,
  PLAN_TIERS,
  PURCHASE_MONTHS,
  addOnKey,
  formatMxn,
  quote,
  type CurrentPlanCarry,
  type Quote,
} from "@/platform/billing";

/** A quote ready to show: amounts already written as «$1,690.00». */
export type ShownQuote = {
  monthly: string;
  /** What the change costs for the days left; null when nothing. */
  prorated: string | null;
  /** What the months bought cost; null with 0 months. */
  forMonths: string | null;
  subtotal: string;
  discount: string | null;
  total: string;
  free: boolean;
};

/** «t500:3:purchasing+sales» = 500 productos, 3 meses, con Compras y Ventas. */
export const quoteKey = (
  tier: string,
  months: number | string,
  modules: readonly string[],
) => `${tier}:${months}:${addOnKey(modules)}`;

export function showQuote(value: Quote): ShownQuote {
  return {
    monthly: formatMxn(value.monthly),
    prorated: value.prorated === "0.00" ? null : formatMxn(value.prorated),
    forMonths:
      value.subtotal === value.prorated
        ? null
        : formatMxn(dec(value.subtotal).minus(value.prorated)),
    subtotal: formatMxn(value.subtotal),
    discount: value.discount === "0.00" ? null : formatMxn(value.discount),
    total: formatMxn(value.total),
    free: value.total === "0.00",
  };
}

/**
 * Every combination with a code's discount, priced by the same `quote` the
 * checkout uses: the browser only looks the chosen one up, never adds.
 * Over a live plan (`carry`) it includes the difference for the days left,
 * and 0 months: only that difference until the plan ends (BIL-08).
 */
export function quoteTable(
  percentOff: number,
  carry: CurrentPlanCarry | null,
): Record<string, ShownQuote> {
  const table: Record<string, ShownQuote> = {};
  for (const tier of PLAN_TIERS) {
    for (const months of carry ? [0, ...PURCHASE_MONTHS] : PURCHASE_MONTHS) {
      for (const modules of ADD_ON_CHOICES) {
        table[quoteKey(tier.id, months, modules)] = showQuote(
          quote(tier, modules, months, percentOff, carry),
        );
      }
    }
  }
  return table;
}
