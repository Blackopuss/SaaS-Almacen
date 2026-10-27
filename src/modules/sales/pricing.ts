import { Decimal, dec, formatDecimal, type DecimalInput } from "@/lib";

/**
 * Sale prices (VEN-03, ADR 0030). Pure: no database.
 *
 * Each presentation may have its own price — a box of 500 screws at $500
 * while a loose one is $1.50 — and one without its own price sells at
 * content × unit price. Prices have cents: two decimals.
 */

const MAX_PRICE = "9999999999.99";

/** A price as people type it («1.50», «$1,250»); null when it is not one. */
export function parsePrice(text: string): string | null {
  const value = text
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null;
  const price = dec(value);
  return price.greaterThan(MAX_PRICE) ? null : price.toFixed(2);
}

export const PRICE_FORMAT_ERROR =
  "Escribe el precio como 1.50 o 1,250, con hasta 2 decimales, o déjalo vacío.";

/**
 * What one presentation sells at: its own price, or content × unit price
 * rounded to cents; null when neither is known.
 */
export function effectivePrice(
  own: DecimalInput | null,
  unitPrice: DecimalInput | null,
  factor: DecimalInput,
): Decimal | null {
  if (own !== null) return dec(own);
  if (unitPrice === null) return null;
  return dec(unitPrice)
    .times(dec(factor))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** «$1,250.00». */
export const formatMoney = (amount: DecimalInput) =>
  `$${formatDecimal(dec(amount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP), {
    minScale: 2,
    maxScale: 2,
  })}`;
