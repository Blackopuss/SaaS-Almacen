import { Decimal, dec, type DecimalInput } from "@/lib";

/**
 * Discounts of a sale (VEN-14, ADR 0030). Pure: no database.
 *
 * A discount is a percent of the whole sale, with its reason. Each role
 * gives up to the cap the titular set for it; the titular has no cap. Above
 * their cap, someone with a cap large enough allows it at the counter.
 */

/** Caps by role, in percent: «5.00». */
export type DiscountCaps = {
  cashier: string;
  cash_manager: string;
  administrator: string;
};

export const DEFAULT_DISCOUNT_CAPS: DiscountCaps = {
  cashier: "5.00",
  cash_manager: "20.00",
  administrator: "100.00",
};

export const DISCOUNT_CAP_ROLES = [
  "cashier",
  "cash_manager",
  "administrator",
] as const satisfies readonly (keyof DiscountCaps)[];

/** A percent as people type it («10», «12.5 %»); null when it is not one. */
export function parsePercent(text: string): string | null {
  const value = String(text ?? "")
    .trim()
    .replace(/\s*%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const percent = dec(value);
  return percent.greaterThan(100) ? null : percent.toFixed(2);
}

export const PERCENT_ERROR =
  "Escribe el descuento como un número del 0 al 100, por ejemplo 10.";

/** The largest discount a person gives without asking, in percent. */
export function capOf(
  subject: { isOwner: boolean; roles: readonly string[] },
  caps: DiscountCaps,
): Decimal {
  if (subject.isOwner === true) return dec(100);
  return subject.roles.reduce((largest, role) => {
    const cap = (caps as Record<string, string | undefined>)[role];
    return cap !== undefined && dec(cap).greaterThan(largest)
      ? dec(cap)
      : largest;
  }, dec(0));
}

/**
 * What the discount takes off each line: its amount × percent, in cents,
 * half up. The sale's discount is the sum of the lines'.
 */
export function discountLines(
  amounts: readonly DecimalInput[],
  percent: DecimalInput,
): Decimal[] {
  const rate = dec(percent).dividedBy(100);
  return amounts.map((amount) =>
    dec(amount).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  );
}

/** «10 %», «12.5 %». */
export const formatPercent = (percent: DecimalInput) =>
  `${dec(percent).toDecimalPlaces(2).toString()} %`;
