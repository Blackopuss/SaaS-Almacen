import { describe, expect, it } from "vitest";

import { PLAN_TIERS, findTier, quote } from "./prices";

// ADR 0028: the server computes every amount; exact cents.

const t100 = findTier("t100")!;

describe("purchase quote", () => {
  it("multiplies the monthly price by the months; VAT is already inside", () => {
    expect(quote(t100, [], 1)).toEqual({
      monthly: "349.00",
      subtotal: "349.00",
      discount: "0.00",
      total: "349.00",
    });
    expect(quote(t100, ["purchasing"], 12).subtotal).toBe("6336.00");
  });

  it("takes a code's discount from the subtotal; 100% is free", () => {
    const half = quote(t100, [], 3, 50);
    expect(half).toEqual({
      monthly: "349.00",
      subtotal: "1047.00",
      discount: "523.50",
      total: "523.50",
    });
    expect(quote(t100, ["purchasing"], 6, 100).total).toBe("0.00");
  });

  it("rejects impossible discounts and unknown tiers", () => {
    expect(() => quote(t100, [], 1, 101)).toThrow();
    expect(() => quote(t100, [], 1, 2.5)).toThrow();
    expect(findTier("t42")).toBeNull();
  });

  it("keeps the tiers of the public site", () => {
    expect(PLAN_TIERS.map((tier) => tier.productLimit)).toEqual([
      100, 500, 1000, 3000, 10000,
    ]);
  });
});
