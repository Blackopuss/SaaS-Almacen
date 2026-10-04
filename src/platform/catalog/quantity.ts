/**
 * Quantities of a product (INV-06). Every product is controlled in one
 * unit and accepts quantities in a fixed increment: whole pieces, or
 * meters in steps of 0.01. A quantity that does not fit is rejected, never
 * rounded: stock is not adjusted silently. Pure: no database.
 */
import {
  Decimal,
  dec,
  formatDecimal,
  isAppError,
  isMultipleOf,
  parseDecimal,
} from "@/lib";

import { getUnit, isUnitCode } from "./units";

/** Decimals kept for quantities: thousandths (1 g, 1 mm, 1 mL). */
export const QUANTITY_SCALE = 3;
/** Largest quantity accepted in one capture or held as stock. */
export const MAX_QUANTITY = "999999999.999";

/** Increments a product may use, from whole units to thousandths. */
export const QUANTITY_STEPS = ["1", "0.1", "0.01", "0.001"] as const;
export type QuantityStep = (typeof QUANTITY_STEPS)[number];

export const STEP_LABELS: Record<QuantityStep, string> = {
  "1": "Enteros (1, 2, 3)",
  "0.1": "Un decimal (0.1)",
  "0.01": "Dos decimales (0.01)",
  "0.001": "Tres decimales (0.001)",
};

/** Increment proposed for a unit: whole for things counted, 0.01 for measures. */
export function defaultStep(unitCode: string): QuantityStep {
  return getUnit(unitCode).fractional ? "0.01" : "1";
}

/** Steps a unit may use: things that are counted only go in whole units. */
export function stepsForUnit(unitCode: string): QuantityStep[] {
  return getUnit(unitCode).fractional ? [...QUANTITY_STEPS] : ["1"];
}

/** Message when the pair unit/step is not valid; null when it is. */
export function stepProblem(unitCode: string, step: string): string | null {
  if (!isUnitCode(unitCode)) return "Elige una unidad de la lista.";
  const allowed = stepsForUnit(unitCode);
  const normalized = allowed.find((option) => {
    try {
      return dec(option).equals(dec(step));
    } catch {
      return false;
    }
  });
  if (normalized) return null;
  return getUnit(unitCode).fractional
    ? "Elige una precisión de la lista."
    : `Los productos por ${getUnit(unitCode).name} se manejan en enteros.`;
}

/** How a product measures its quantities. */
export type QuantityRule = { unitCode: string; quantityStep: string };

export type ParsedQuantity =
  { ok: true; quantity: Decimal } | { ok: false; error: string };

/**
 * Reads a quantity typed by a person for a product: "3", "2.75", "1,250".
 * It must be greater than zero, fit the product's increment and not exceed
 * the maximum.
 */
export function parseQuantity(
  rule: QuantityRule,
  input: string,
): ParsedQuantity {
  const unit = getUnit(rule.unitCode);
  const step = dec(rule.quantityStep);
  let quantity: Decimal;
  try {
    quantity = parseDecimal(String(input ?? ""), {
      maxScale: QUANTITY_SCALE,
      allowZero: false,
    });
  } catch (error) {
    if (!isAppError(error)) throw error;
    const messages: Record<string, string> = {
      "decimal.too_many_decimals": `Usa como máximo ${QUANTITY_SCALE} decimales.`,
      "decimal.negative": "La cantidad debe ser mayor que cero.",
      "decimal.zero": "La cantidad debe ser mayor que cero.",
    };
    return {
      ok: false,
      error:
        messages[error.code] ?? "Escribe una cantidad, por ejemplo 3 o 2.75.",
    };
  }
  if (quantity.greaterThan(MAX_QUANTITY)) {
    return { ok: false, error: "La cantidad es demasiado grande." };
  }
  if (!isMultipleOf(quantity, step)) {
    return {
      ok: false,
      error: step.equals(1)
        ? `Este producto se maneja en ${unit.plural} completos: no admite fracciones.`.replace(
            "completos",
            unit.plural.endsWith("as") ? "completas" : "completos",
          )
        : `Este producto se maneja en pasos de ${formatDecimal(step)} ${unit.plural}.`,
    };
  }
  return { ok: true, quantity };
}
