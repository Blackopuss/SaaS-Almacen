import { describe, expect, it } from "vitest";

import { dec } from "@/lib";

import {
  valueEntry,
  valueExit,
  valueExitAt,
  type CostState,
} from "./average-cost";

// VAL-01 (ADR 0031): moving average price, kept as value + price.

const state = (averageCost: string, stockValue: string): CostState => ({
  averageCost: dec(averageCost),
  stockValue: dec(stockValue),
});

const plain = (result: ReturnType<typeof valueEntry>) => ({
  averageCost: result.state?.averageCost.toFixed(6) ?? null,
  stockValue: result.state?.stockValue.toFixed(6) ?? null,
  unitCost: result.unitCost?.toFixed(6) ?? null,
});

describe("entries", () => {
  it("averages by value: 10 at $85 + 10 at $95 → $90", () => {
    const first = valueEntry(null, "0", "10", "85");
    expect(plain(first)).toEqual({
      averageCost: "85.000000",
      stockValue: "850.000000",
      unitCost: "85.000000",
    });
    expect(plain(valueEntry(first.state, "10", "10", "95"))).toEqual({
      averageCost: "90.000000",
      stockValue: "1800.000000",
      unitCost: "95.000000",
    });
  });

  it("an entry without a cost comes in at the current price", () => {
    expect(plain(valueEntry(state("90", "1800"), "20", "5", null))).toEqual({
      averageCost: "90.000000",
      stockValue: "2250.000000",
      unitCost: "90.000000",
    });
  });

  it("without any known cost, nothing is valued", () => {
    expect(plain(valueEntry(null, "4", "6", null))).toEqual({
      averageCost: null,
      stockValue: null,
      unitCost: null,
    });
  });

  it("the first known cost also values the stock that had none", () => {
    expect(plain(valueEntry(null, "4", "6", "10"))).toEqual({
      averageCost: "10.000000",
      stockValue: "100.000000",
      unitCost: "10.000000",
    });
  });

  it("keeps six decimals, rounding half up", () => {
    // 1 at $1 + 2 at $2 = 5 / 3 = 1.666667.
    const one = valueEntry(null, "0", "1", "1");
    expect(plain(valueEntry(one.state, "1", "2", "2")).averageCost).toBe(
      "1.666667",
    );
    // Fractional quantities (2.75 m of cable at $12.34).
    expect(plain(valueEntry(null, "0", "2.75", "12.34")).stockValue).toBe(
      "33.935000",
    );
  });

  it("rejects negative costs, stock and quantities", () => {
    expect(() => valueEntry(null, "0", "1", "-1")).toThrow(RangeError);
    expect(() => valueEntry(null, "-1", "1", "1")).toThrow(RangeError);
    expect(() => valueEntry(null, "0", "0", "1")).toThrow(RangeError);
  });
});

describe("exits", () => {
  it("take value at the current price and never move it", () => {
    expect(plain(valueExit(state("90", "1800"), "20", "5"))).toEqual({
      averageCost: "90.000000",
      stockValue: "1350.000000",
      unitCost: "90.000000",
    });
  });

  it("leave no residue when nothing is left, and keep the price", () => {
    // 1 at $1 + 2 at $2: price 1.666667 × 3 = 5.000001 ≠ 5.
    const one = valueEntry(null, "0", "1", "1");
    const three = valueEntry(one.state, "1", "2", "2");
    expect(plain(valueExit(three.state, "3", "3"))).toEqual({
      averageCost: "1.666667",
      stockValue: "0.000000",
      unitCost: "1.666667",
    });
  });

  it("without a known cost stay unvalued; never more than the stock", () => {
    expect(plain(valueExit(null, "5", "2"))).toEqual({
      averageCost: null,
      stockValue: null,
      unitCost: null,
    });
    expect(() => valueExit(state("1", "5"), "5", "6")).toThrow(RangeError);
  });
});

describe("exits at the cost they came in with", () => {
  it("a return of the $95 entry leaves the $85 ones", () => {
    // 10 at $85 + 10 at $95 = $1,800; give back the 10 at $95.
    expect(plain(valueExitAt(state("90", "1800"), "20", "10", "95"))).toEqual({
      averageCost: "85.000000",
      stockValue: "850.000000",
      unitCost: "95.000000",
    });
  });

  it("returning everything leaves no value and keeps the price", () => {
    expect(plain(valueExitAt(state("90", "1800"), "20", "20", "95"))).toEqual({
      averageCost: "90.000000",
      stockValue: "0.000000",
      unitCost: "95.000000",
    });
  });

  it("without a cost it is an ordinary exit", () => {
    expect(plain(valueExitAt(state("90", "1800"), "20", "5", null))).toEqual({
      averageCost: "90.000000",
      stockValue: "1350.000000",
      unitCost: "90.000000",
    });
    expect(plain(valueExitAt(null, "20", "5", "95")).unitCost).toBeNull();
  });

  it("never leaves a negative value", () => {
    // The average fell after the entry; taking it back at $95 would go below zero.
    expect(plain(valueExitAt(state("10", "100"), "10", "5", "95"))).toEqual({
      averageCost: "0.000000",
      stockValue: "0.000000",
      unitCost: "95.000000",
    });
  });
});
