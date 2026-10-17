/**
 * Conversion to the product's unit (INV-09). Stock is kept once, in the
 * unit of the product; whatever a person captures — pieces, boxes, or
 * centimeters for a product kept in meters — becomes a quantity of that
 * unit before anything is written:
 *
 *   quantity in base unit = captured quantity × factor
 *
 * The factor always comes from the server (the current version of the
 * presentation, or the unit catalog), never from the browser. Pure: the
 * caller loads the product and the presentation (see ./conversion-service).
 */
import {
  Decimal,
  ValidationError,
  dec,
  formatDecimal,
  isAppError,
  isMultipleOf,
} from "@/lib";

import { MAX_QUANTITY, parseQuantity, type QuantityRule } from "./quantity";
import { convertUnits, getUnit } from "./units";

/** What the person captured. */
export type Capture =
  /** A quantity in the product's own unit: "25" piezas. */
  | { kind: "base"; quantity: string }
  /** A number of presentations: "3" cajas. */
  | { kind: "presentation"; quantity: string; presentationId: string }
  /** A quantity in another unit of the same dimension: "275" cm. */
  | { kind: "unit"; quantity: string; unitCode: string };

/** The presentation version the server resolved for a capture. */
export type ResolvedPresentation = {
  id: string;
  name: string;
  versionId: string;
  version: number;
  factor: string;
};

export type Conversion = {
  /** Quantity in the product's unit: what moves stock. */
  baseQuantity: Decimal;
  /** As captured, to be stored with the movement line. */
  capturedQuantity: Decimal;
  /** Multiplier applied (1 when captured in the product's unit). */
  factor: Decimal;
  /** Presentation version used, when one was. */
  presentation: ResolvedPresentation | null;
  /** Unit of the capture when it was not the product's. */
  capturedUnitCode: string | null;
  /** «3 cajas × 100 = 300 piezas», shown before confirming. */
  preview: string;
};

export type ConversionResult =
  { ok: true; conversion: Conversion } | { ok: false; error: string };

const fail = (error: string): ConversionResult => ({ ok: false, error });

/** "caja" → "cajas", "costal" → "costales"; names of several words are left alone. */
export function pluralizeName(name: string, quantity: Decimal): string {
  const text = name.trim().toLowerCase();
  if (quantity.equals(1) || /\s/.test(text)) return text;
  if (/[sx]$/.test(text)) return text;
  if (/z$/.test(text)) return `${text.slice(0, -1)}ces`;
  return /[aeiouáéíóú]$/.test(text) ? `${text}s` : `${text}es`;
}

function amount(quantity: Decimal, unitCode: string): string {
  const unit = getUnit(unitCode);
  return `${formatDecimal(quantity)} ${quantity.equals(1) ? unit.name : unit.plural}`;
}

/** The base quantity must fit the product's own rule; nothing is rounded. */
function fitBase(rule: QuantityRule, base: Decimal): string | null {
  const unit = getUnit(rule.unitCode);
  if (base.lte(0)) return "La cantidad debe ser mayor que cero.";
  if (base.greaterThan(MAX_QUANTITY)) return "La cantidad es demasiado grande.";
  if (!isMultipleOf(base, rule.quantityStep)) {
    return dec(rule.quantityStep).equals(1)
      ? `Eso equivale a ${amount(base, rule.unitCode)}, y este producto no admite fracciones.`
      : `Eso equivale a ${amount(base, rule.unitCode)}, y este producto se maneja en pasos de ${formatDecimal(rule.quantityStep)} ${unit.plural}.`;
  }
  return null;
}

/**
 * Converts a capture to the product's unit. `presentation` is the version
 * the server resolved for `capture.presentationId` (null when there is
 * none or it belongs to another product).
 */
export function convertCapture(
  rule: QuantityRule,
  capture: Capture,
  presentation: ResolvedPresentation | null = null,
): ConversionResult {
  if (capture.kind === "base") {
    const parsed = parseQuantity(rule, capture.quantity);
    if (!parsed.ok) return fail(parsed.error);
    return {
      ok: true,
      conversion: {
        baseQuantity: parsed.quantity,
        capturedQuantity: parsed.quantity,
        factor: dec(1),
        presentation: null,
        capturedUnitCode: null,
        preview: amount(parsed.quantity, rule.unitCode),
      },
    };
  }

  if (capture.kind === "presentation") {
    if (!presentation || presentation.id !== capture.presentationId) {
      return fail("Esa presentación no existe para este producto.");
    }
    // Presentations are counted whole; a partial box is captured in the
    // product's unit.
    const count = parseQuantity(
      { unitCode: "piece", quantityStep: "1" },
      capture.quantity,
    );
    if (!count.ok) {
      return fail(
        /completas/.test(count.error)
          ? `Las presentaciones se capturan completas. Para una parte de ${presentation.name.toLowerCase()}, captura en ${getUnit(rule.unitCode).plural}.`
          : count.error,
      );
    }
    const factor = dec(presentation.factor);
    const base = count.quantity.times(factor);
    const problem = fitBase(rule, base);
    if (problem) return fail(problem);
    return {
      ok: true,
      conversion: {
        baseQuantity: base,
        capturedQuantity: count.quantity,
        factor,
        presentation,
        capturedUnitCode: null,
        preview: `${formatDecimal(count.quantity)} ${pluralizeName(presentation.name, count.quantity)} × ${formatDecimal(factor)} = ${amount(base, rule.unitCode)}`,
      },
    };
  }

  // Another unit of the same dimension.
  let factor: Decimal;
  try {
    factor = convertUnits(1, capture.unitCode, rule.unitCode);
  } catch (error) {
    if (isAppError(error) && error instanceof ValidationError) {
      return fail(error.message);
    }
    throw error;
  }
  if (capture.unitCode === rule.unitCode) {
    return convertCapture(rule, { kind: "base", quantity: capture.quantity });
  }
  const captured = parseQuantity(
    {
      unitCode: capture.unitCode,
      quantityStep: getUnit(capture.unitCode).fractional ? "0.001" : "1",
    },
    capture.quantity,
  );
  if (!captured.ok) return fail(captured.error);
  const base = captured.quantity.times(factor);
  const problem = fitBase(rule, base);
  if (problem) return fail(problem);
  return {
    ok: true,
    conversion: {
      baseQuantity: base,
      capturedQuantity: captured.quantity,
      factor,
      presentation: null,
      capturedUnitCode: capture.unitCode,
      preview: `${amount(captured.quantity, capture.unitCode)} = ${amount(base, rule.unitCode)}`,
    },
  };
}

/**
 * How a stock quantity reads in a presentation: «250 piezas, equivalentes
 * a 2 cajas de 100 y 50 piezas». It is arithmetic, not proof that two
 * closed boxes exist.
 */
export function describeInPresentation(
  rule: QuantityRule,
  quantity: Decimal,
  presentation: { name: string; factor: string },
): string {
  const total = amount(quantity, rule.unitCode);
  const factor = dec(presentation.factor);
  if (quantity.lessThan(factor)) return total;
  const whole = quantity.dividedToIntegerBy(factor);
  const rest = quantity.minus(whole.times(factor));
  const boxes = `${formatDecimal(whole)} ${pluralizeName(presentation.name, whole)} de ${formatDecimal(factor)}`;
  return rest.isZero()
    ? `${total}, equivalentes a ${boxes}`
    : `${total}, equivalentes a ${boxes} y ${amount(rest, rule.unitCode)}`;
}
