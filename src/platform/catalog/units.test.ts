import { describe, expect, it } from "vitest";

import { isAppError } from "@/lib";

import {
  DIMENSIONS,
  UNITS,
  areCompatible,
  convertUnits,
  formatQuantity,
  getUnit,
  isUnitCode,
  unitsOfDimension,
} from "./units";

// INV-05: catalog of units and dimensions.

describe("catalog", () => {
  it("has pieza, par, docena, kg, g, m, cm, mm, L, mL and m²", () => {
    expect(UNITS.map((unit) => unit.symbol)).toEqual([
      "pza",
      "par",
      "doc",
      "kg",
      "g",
      "m",
      "cm",
      "mm",
      "L",
      "mL",
      "m²",
    ]);
    expect(new Set(UNITS.map((unit) => unit.code)).size).toBe(UNITS.length);
  });

  it("groups units by dimension, each with one reference unit", () => {
    expect(unitsOfDimension("count").map((u) => u.name)).toEqual([
      "pieza",
      "par",
      "docena",
    ]);
    expect(unitsOfDimension("area").map((u) => u.code)).toEqual(["m2"]);
    for (const dimension of DIMENSIONS) {
      const references = unitsOfDimension(dimension).filter(
        (unit) => unit.toReference === "1",
      );
      expect(references, dimension).toHaveLength(1);
    }
  });

  it("things that are counted are whole; measures may have decimals", () => {
    for (const unit of UNITS) {
      expect(unit.fractional, unit.code).toBe(unit.dimension !== "count");
    }
  });

  it("codes are short and stable", () => {
    for (const unit of UNITS) {
      expect(unit.code).toMatch(/^[a-z][a-z0-9]{0,11}$/);
      expect(isUnitCode(unit.code)).toBe(true);
    }
    expect(isUnitCode("caja")).toBe(false);
    expect(isUnitCode(undefined)).toBe(false);
    expect(() => getUnit("caja")).toThrow("Esa unidad no existe.");
  });
});

describe("convertUnits", () => {
  it.each([
    ["3", "dozen", "piece", "36"],
    ["2", "pair", "piece", "4"],
    ["24", "piece", "dozen", "2"],
    ["2.5", "kg", "g", "2500"],
    ["750", "g", "kg", "0.75"],
    ["2.75", "m", "cm", "275"],
    ["1", "mm", "m", "0.001"],
    ["19", "l", "ml", "19000"],
    ["250", "ml", "l", "0.25"],
    ["12.5", "m2", "m2", "12.5"],
  ])("%s %s → %s = %s", (quantity, from, to, expected) => {
    expect(convertUnits(quantity, from, to).toString()).toBe(expected);
  });

  it("is exact with decimals", () => {
    expect(
      convertUnits("0.1", "kg", "g")
        .plus(convertUnits("0.2", "kg", "g"))
        .toString(),
    ).toBe("300");
    expect(convertUnits("197.25", "m", "mm").toString()).toBe("197250");
    expect(
      convertUnits(convertUnits("2.75", "m", "mm"), "mm", "m").toString(),
    ).toBe("2.75");
  });

  it.each([
    ["kg", "piece"],
    ["l", "kg"],
    ["m", "m2"],
    ["piece", "m"],
  ])("refuses %s → %s", (from, to) => {
    expect(areCompatible(from, to)).toBe(false);
    try {
      convertUnits("1", from, to);
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("incompatible_units");
      expect((error as Error).message).toMatch(/miden cosas distintas/);
    }
  });

  it("refuses unknown units and numbers that are not exact", () => {
    expect(() => convertUnits("1", "caja", "piece")).toThrow();
    expect(areCompatible("caja", "piece")).toBe(false);
    expect(() => convertUnits(0.1, "kg", "g")).toThrow();
  });
});

describe("formatQuantity", () => {
  it("uses singular and plural", () => {
    expect(formatQuantity("1", "piece")).toBe("1 pieza");
    expect(formatQuantity("300", "piece")).toBe("300 piezas");
    expect(formatQuantity("2.75", "m")).toBe("2.75 metros");
    expect(formatQuantity("1", "m2")).toBe("1 metro cuadrado");
  });
});
