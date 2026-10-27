import { describe, expect, it } from "vitest";

import {
  DEFAULT_DISCOUNT_CAPS,
  capOf,
  discountLines,
  formatPercent,
  parsePercent,
} from "./discounts";

describe("discounts", () => {
  it("reads percents", () => {
    expect(parsePercent("10")).toBe("10.00");
    expect(parsePercent("12.5 %")).toBe("12.50");
    expect(parsePercent("101")).toBeNull();
    expect(parsePercent("-5")).toBeNull();
    expect(parsePercent("diez")).toBeNull();
    expect(formatPercent("12.50")).toBe("12.5 %");
  });

  it("each role has its cap; the titular has none; roles add up to the largest", () => {
    const caps = DEFAULT_DISCOUNT_CAPS;
    const cap = (isOwner: boolean, ...roles: string[]) =>
      capOf({ isOwner, roles }, caps).toString();
    expect(cap(false, "cashier")).toBe("5");
    expect(cap(false, "cash_manager")).toBe("20");
    expect(cap(false, "cashier", "cash_manager")).toBe("20");
    expect(cap(false, "warehouse")).toBe("0");
    expect(cap(false)).toBe("0");
    expect(cap(true)).toBe("100");
  });

  it("takes the percent off each line, in cents, half up", () => {
    expect(
      discountLines(["500", "4.50", "0.05"], "10").map((d) => d.toFixed(2)),
    ).toEqual(["50.00", "0.45", "0.01"]);
  });
});
