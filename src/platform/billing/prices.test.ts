import { describe, expect, it } from "vitest";

import { PLAN_TIERS, findTier, quote } from "./prices";

// ADR 0028: the server computes every amount; exact cents.

const t100 = findTier("t100")!;

describe("purchase quote", () => {
  it("multiplies the monthly price by the months; VAT is already inside", () => {
    expect(quote(t100, [], 1)).toEqual({
      monthly: "349.00",
      prorated: "0.00",
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
      prorated: "0.00",
      subtotal: "1047.00",
      discount: "523.50",
      total: "523.50",
    });
    expect(quote(t100, ["purchasing"], 6, 100).total).toBe("0.00");
  });

  it("over a live plan, charges what the new one costs more for the days left (BIL-08)", () => {
    const t500 = findTier("t500")!;
    // Inventario 100 ($349) with 15 days left → + Ventas ($249 more a month).
    const carry = { monthly: "349.00", daysLeft: 15 };
    expect(quote(t100, ["sales"], 0, 0, carry)).toEqual({
      monthly: "598.00",
      prorated: "124.50",
      subtotal: "124.50",
      discount: "0.00",
      total: "124.50",
    });
    // The difference for the days left plus the months bought.
    expect(quote(t500, [], 1, 0, carry)).toMatchObject({
      prorated: "150.00",
      subtotal: "799.00",
    });
    // A smaller plan is not refunded: only its months are charged.
    expect(
      quote(t100, [], 1, 0, { monthly: "1347.00", daysLeft: 20 }),
    ).toMatchObject({ prorated: "0.00", total: "349.00" });
    // Nothing left of the current plan: nothing to prorate.
    expect(
      quote(t100, ["sales"], 0, 0, { monthly: "349.00", daysLeft: 0 }),
    ).toMatchObject({ total: "0.00" });
    expect(() => quote(t100, [], 13)).toThrow();
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
