import "server-only";

import {
  PLAN_TIERS,
  PURCHASE_MONTHS,
  formatMxn,
  quote,
  type Quote,
} from "@/platform/billing";

/** A quote ready to show: amounts already written as «$1,690.00». */
export type ShownQuote = {
  monthly: string;
  subtotal: string;
  discount: string | null;
  total: string;
  free: boolean;
};

/** «t500:3:1» = 500 productos, 3 meses, con Compras. */
export const quoteKey = (tier: string, months: number, purchasing: boolean) =>
  `${tier}:${months}:${purchasing ? 1 : 0}`;

export function showQuote(value: Quote): ShownQuote {
  return {
    monthly: formatMxn(value.monthly),
    subtotal: formatMxn(value.subtotal),
    discount: value.discount === "0.00" ? null : formatMxn(value.discount),
    total: formatMxn(value.total),
    free: value.total === "0.00",
  };
}

/**
 * Every combination with a code's discount, priced by the same `quote` the
 * checkout uses: the browser only looks the chosen one up, never adds.
 */
export function quoteTable(percentOff: number): Record<string, ShownQuote> {
  const table: Record<string, ShownQuote> = {};
  for (const tier of PLAN_TIERS) {
    for (const months of PURCHASE_MONTHS) {
      for (const purchasing of [false, true]) {
        table[quoteKey(tier.id, months, purchasing)] = showQuote(
          quote(tier, purchasing ? ["purchasing"] : [], months, percentOff),
        );
      }
    }
  }
  return table;
}
