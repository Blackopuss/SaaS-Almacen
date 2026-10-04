import { describe, expect, it } from "vitest";

import {
  defaultStep,
  parseQuantity,
  stepProblem,
  stepsForUnit,
} from "./quantity";
import { UNITS } from "./units";

// INV-06: precision and increment per product. 0.5 pieces is rejected;
// 2.75 m is accepted.

const pieces = { unitCode: "piece", quantityStep: "1" };
const meters = { unitCode: "m", quantityStep: "0.01" };
const kilos = { unitCode: "kg", quantityStep: "0.001" };

const quantity = (rule: typeof pieces, input: string) => {
  const result = parseQuantity(rule, input);
  return result.ok ? result.quantity.toString() : result.error;
};

describe("parseQuantity", () => {
  it("0.5 pieces is rejected", () => {
    expect(parseQuantity(pieces, "0.5")).toEqual({
      ok: false,
      error:
        "Este producto se maneja en piezas completas: no admite fracciones.",
    });
    expect(parseQuantity(pieces, "2.5").ok).toBe(false);
    expect(quantity(pieces, "3")).toBe("3");
    expect(quantity(pieces, "300")).toBe("300");
  });

  it("2.75 m is accepted", () => {
    expect(quantity(meters, "2.75")).toBe("2.75");
    expect(quantity(meters, "197.25")).toBe("197.25");
    expect(quantity(meters, "100")).toBe("100");
  });

  it("a quantity finer than the product's increment is rejected, not rounded", () => {
    expect(parseQuantity(meters, "2.755")).toEqual({
      ok: false,
      error: "Este producto se maneja en pasos de 0.01 metros.",
    });
    expect(quantity(kilos, "2.755")).toBe("2.755");
    expect(parseQuantity(kilos, "2.7555")).toEqual({
      ok: false,
      error: "Usa como máximo 3 decimales.",
    });
    expect(
      parseQuantity({ unitCode: "l", quantityStep: "0.1" }, "19.25").ok,
    ).toBe(false);
  });

  it("accepts what people type: spaces, thousands commas, trailing zeros", () => {
    expect(quantity(pieces, " 1,250 ")).toBe("1250");
    expect(quantity(meters, "2.50")).toBe("2.5");
    expect(quantity(pieces, "3.000")).toBe("3");
  });

  it.each(["0", "0.00", "-1", "-0.5"])(
    "rejects %s: not greater than zero",
    (input) => {
      expect(parseQuantity(meters, input)).toEqual({
        ok: false,
        error: "La cantidad debe ser mayor que cero.",
      });
    },
  );

  it.each(["", "abc", "1e3", "2,5", "1.2.3", "½", "Infinity", "NaN", "0x10"])(
    "rejects %j: not a quantity",
    (input) => {
      expect(parseQuantity(meters, input)).toEqual({
        ok: false,
        error: "Escribe una cantidad, por ejemplo 3 o 2.75.",
      });
    },
  );

  it("rejects quantities beyond the maximum", () => {
    expect(quantity(pieces, "999999999")).toBe("999999999");
    expect(parseQuantity(pieces, "1000000000")).toEqual({
      ok: false,
      error: "La cantidad es demasiado grande.",
    });
  });

  it("is exact: tenths add up", () => {
    const rule = { unitCode: "kg", quantityStep: "0.1" };
    const a = parseQuantity(rule, "0.1");
    const b = parseQuantity(rule, "0.2");
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.quantity.plus(b.quantity).toString()).toBe("0.3");
  });

  it("names the unit in the message", () => {
    expect(
      (
        parseQuantity({ unitCode: "pair", quantityStep: "1" }, "1.5") as {
          error: string;
        }
      ).error,
    ).toBe("Este producto se maneja en pares completos: no admite fracciones.");
    expect(
      (
        parseQuantity({ unitCode: "dozen", quantityStep: "1" }, "0.5") as {
          error: string;
        }
      ).error,
    ).toBe(
      "Este producto se maneja en docenas completas: no admite fracciones.",
    );
  });
});

describe("increments per unit", () => {
  it("things that are counted only go in whole units", () => {
    for (const unit of UNITS.filter((u) => u.dimension === "count")) {
      expect(stepsForUnit(unit.code)).toEqual(["1"]);
      expect(defaultStep(unit.code)).toBe("1");
      expect(stepProblem(unit.code, "1")).toBeNull();
      expect(stepProblem(unit.code, "0.5")).toMatch(/se manejan en enteros/);
    }
  });

  it("measures go from whole units to thousandths, 0.01 by default", () => {
    for (const unit of UNITS.filter((u) => u.dimension !== "count")) {
      expect(stepsForUnit(unit.code)).toEqual(["1", "0.1", "0.01", "0.001"]);
      expect(defaultStep(unit.code)).toBe("0.01");
      for (const step of ["1", "0.1", "0.01", "0.001", "0.010", "1.0"]) {
        expect(stepProblem(unit.code, step), step).toBeNull();
      }
      for (const step of ["0.5", "0.0001", "0", "-1", "abc", ""]) {
        expect(stepProblem(unit.code, step), step).toBe(
          "Elige una precisión de la lista.",
        );
      }
    }
  });

  it("an unknown unit is a problem", () => {
    expect(stepProblem("caja", "1")).toBe("Elige una unidad de la lista.");
  });
});
