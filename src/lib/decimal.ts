import DecimalJs from "decimal.js";

import { ValidationError } from "./errors";

/**
 * Exact decimal arithmetic for quantities and money. Never use JS `number`
 * for stock or amounts: 0.1 + 0.2 must be exactly 0.3.
 */
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

export type DecimalInput = Decimal | string | bigint | number;

// Plain decimal notation as typed by people or stored by MySQL: "-12.5", "3".
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Converts a value to Decimal. Numbers are accepted only when they are safe
 * integers, so floating-point noise can never enter a calculation.
 */
export function dec(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "bigint") return new Decimal(value.toString());
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ValidationError(
        "decimal.unsafe_number",
        "Use a string for non-integer quantities.",
        { value },
      );
    }
    return new Decimal(value);
  }
  const text = value.trim();
  if (!DECIMAL_PATTERN.test(text)) {
    throw new ValidationError("decimal.invalid", "Invalid decimal value.", {
      value,
    });
  }
  return new Decimal(text);
}

export type ParseDecimalOptions = {
  /** Maximum digits after the decimal point. */
  maxScale: number;
  /** Allow values below zero (default false). */
  allowNegative?: boolean;
  /** Allow zero (default true). */
  allowZero?: boolean;
};

/**
 * Parses user input such as "2.75" or "1,250.5" (thousands commas allowed,
 * decimal point required). Rejects instead of rounding: stock is never
 * rounded silently.
 */
export function parseDecimal(
  input: string,
  options: ParseDecimalOptions,
): Decimal {
  const text = input.trim().replace(/,(?=\d{3}(\D|$))/g, "");
  if (!DECIMAL_PATTERN.test(text)) {
    throw new ValidationError("decimal.invalid", "Invalid decimal value.", {
      input,
    });
  }
  const value = new Decimal(text);
  if (value.decimalPlaces() > options.maxScale) {
    throw new ValidationError(
      "decimal.too_many_decimals",
      "Too many decimals.",
      {
        input,
        maxScale: options.maxScale,
      },
    );
  }
  if (!options.allowNegative && value.isNegative() && !value.isZero()) {
    throw new ValidationError("decimal.negative", "Value cannot be negative.", {
      input,
    });
  }
  if (options.allowZero === false && value.isZero()) {
    throw new ValidationError(
      "decimal.zero",
      "Value must be greater than zero.",
      {
        input,
      },
    );
  }
  return value;
}

/** True when `value` is an exact multiple of `step` (e.g. whole pieces). */
export function isMultipleOf(value: DecimalInput, step: DecimalInput): boolean {
  const s = dec(step);
  if (s.lte(0)) {
    throw new ValidationError("decimal.invalid_step", "Step must be positive.");
  }
  return dec(value).mod(s).isZero();
}

/** Fixed-scale string for storage, rejecting values that would lose digits. */
export function toFixedScale(value: DecimalInput, scale: number): string {
  const d = dec(value);
  if (d.decimalPlaces() > scale) {
    throw new ValidationError(
      "decimal.precision_loss",
      "Value has more decimals than allowed.",
      { value: d.toString(), scale },
    );
  }
  return d.toFixed(scale);
}

/**
 * Formats for people in Mexico: "1250.5" → "1,250.5". Display only; rounds
 * half-even when `maxScale` is lower than the value's decimals.
 */
export function formatDecimal(
  value: DecimalInput,
  options: { maxScale?: number; minScale?: number } = {},
): string {
  const d = dec(value);
  const natural = d.decimalPlaces();
  const scale = Math.max(
    Math.min(natural, options.maxScale ?? natural),
    options.minScale ?? 0,
  );
  const [intPart = "0", fraction] = d.toFixed(scale).split(".");
  const negative = intPart.startsWith("-");
  const digits = negative ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}
