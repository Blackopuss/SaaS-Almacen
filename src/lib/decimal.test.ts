import { describe, expect, it } from "vitest";

import {
  dec,
  formatDecimal,
  isMultipleOf,
  parseDecimal,
  toFixedScale,
} from "./decimal";
import { ValidationError } from "./errors";

describe("exact arithmetic", () => {
  it("adds 0.1 + 0.2 exactly", () => {
    expect(dec("0.1").plus("0.2").toString()).toBe("0.3");
    expect(dec("0.1").plus("0.2").eq("0.3")).toBe(true);
  });

  it("UNI-03: 2 rolls of 100 m minus 2.75 m is 197.25 m", () => {
    const meters = dec(2).times(100).minus("2.75");
    expect(meters.toString()).toBe("197.25");
  });

  it("UNI-02: 3 boxes of 100 − 25 + 1 box of 120 = 395 pieces", () => {
    const pieces = dec(3).times(100).minus(25).plus(dec(1).times(120));
    expect(pieces.toString()).toBe("395");
  });

  it("keeps many small additions exact", () => {
    let total = dec(0);
    for (let i = 0; i < 1000; i++) total = total.plus("0.001");
    expect(total.toString()).toBe("1");
  });
});

describe("dec()", () => {
  it("accepts strings, bigints and safe integers", () => {
    expect(dec("12.50").toString()).toBe("12.5");
    expect(dec(10n).toString()).toBe("10");
    expect(dec(42).toString()).toBe("42");
  });

  it("rejects floating-point numbers", () => {
    expect(() => dec(0.1)).toThrow(ValidationError);
  });

  it("rejects exponent, empty and non-numeric strings", () => {
    for (const bad of ["1e3", "", "abc", "1.2.3", "NaN", "Infinity", ".5"]) {
      expect(() => dec(bad)).toThrow(ValidationError);
    }
  });
});

describe("parseDecimal()", () => {
  it("parses thousands separators", () => {
    expect(parseDecimal("1,250.5", { maxScale: 3 }).toString()).toBe("1250.5");
  });

  it("rejects more decimals than allowed instead of rounding", () => {
    expect(() => parseDecimal("2.7555", { maxScale: 3 })).toThrow(
      expect.objectContaining({ code: "decimal.too_many_decimals" }),
    );
  });

  it("rejects negatives and zero when configured", () => {
    expect(() => parseDecimal("-1", { maxScale: 0 })).toThrow(
      expect.objectContaining({ code: "decimal.negative" }),
    );
    expect(() => parseDecimal("0", { maxScale: 0, allowZero: false })).toThrow(
      expect.objectContaining({ code: "decimal.zero" }),
    );
  });
});

describe("isMultipleOf()", () => {
  it("UNI-04: 0.5 pieces is not a whole piece", () => {
    expect(isMultipleOf("0.5", 1)).toBe(false);
    expect(isMultipleOf("3", 1)).toBe(true);
  });

  it("supports decimal steps", () => {
    expect(isMultipleOf("2.75", "0.25")).toBe(true);
    expect(isMultipleOf("2.7", "0.25")).toBe(false);
  });

  it("rejects non-positive steps", () => {
    expect(() => isMultipleOf("1", 0)).toThrow(ValidationError);
  });
});

describe("toFixedScale()", () => {
  it("pads to the storage scale", () => {
    expect(toFixedScale("197.25", 4)).toBe("197.2500");
  });

  it("refuses to drop digits", () => {
    expect(() => toFixedScale("1.23456", 4)).toThrow(
      expect.objectContaining({ code: "decimal.precision_loss" }),
    );
  });
});

describe("formatDecimal()", () => {
  it("groups thousands for Mexico", () => {
    expect(formatDecimal("1250.5")).toBe("1,250.5");
    expect(formatDecimal("-1234567")).toBe("-1,234,567");
    expect(formatDecimal("0.75")).toBe("0.75");
  });

  it("applies min and max scale", () => {
    expect(formatDecimal("3", { minScale: 2 })).toBe("3.00");
    expect(formatDecimal("2.125", { maxScale: 2 })).toBe("2.12");
  });
});
