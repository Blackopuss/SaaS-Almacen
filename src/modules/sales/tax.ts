import { Decimal, dec, type DecimalInput } from "@/lib";

/**
 * VAT of a sale (VEN-04, ADR 0030). Pure: no database.
 *
 * Each company says whether its prices already include VAT (shown as is;
 * the ticket breaks the VAT out of the total) or not (VAT is added when
 * charging). Rounding is defined once, on the whole sale: half up to cents,
 * so subtotal + VAT always equals the total printed on the ticket.
 */

export type TaxRule = {
  /** Prices already include VAT. */
  pricesIncludeTax: boolean;
  /** Percent, «16.00». */
  rate: string;
};

/** What a company without its own settings uses: Mexican VAT, included. */
export const DEFAULT_TAX_RULE: TaxRule = {
  pricesIncludeTax: true,
  rate: "16.00",
};

export type SaleTotals = {
  /** Before VAT. */
  subtotal: Decimal;
  tax: Decimal;
  /** What the customer pays. */
  total: Decimal;
};

const cents = (amount: Decimal) =>
  amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Totals of a sale from the amount of each line (price × quantity, minus
 * its discount), as the company writes its prices.
 */
export function saleTotals(
  amounts: readonly DecimalInput[],
  rule: TaxRule,
): SaleTotals {
  const sum = amounts.reduce<Decimal>(
    (total, amount) => total.plus(cents(dec(amount))),
    dec(0),
  );
  const rate = dec(rule.rate).dividedBy(100);
  if (rule.pricesIncludeTax) {
    const subtotal = cents(sum.dividedBy(rate.plus(1)));
    return { subtotal, tax: sum.minus(subtotal), total: sum };
  }
  const tax = cents(sum.times(rate));
  return { subtotal: sum, tax, total: sum.plus(tax) };
}

/** A VAT rate as people type it («16», «8.5 %»); null when it is not one. */
export function parseTaxRate(text: string): string | null {
  const value = text.trim().replace(/\s*%$/, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null;
  const rate = dec(value);
  return rate.greaterThan(100) ? null : rate.toFixed(2);
}

export const TAX_RATE_ERROR =
  "Escribe la tasa como un número del 0 al 100, por ejemplo 16 u 8.";

/** «16 %», «8.5 %». */
export const formatTaxRate = (rate: DecimalInput) =>
  `${dec(rate).toDecimalPlaces(2).toString()} %`;
