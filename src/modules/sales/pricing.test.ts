import { describe, expect, it } from "vitest";

import { effectivePrice, formatMoney, parsePrice } from "./pricing";

// VEN-03 (ADR 0030): a price per unit and, if wanted, one per presentation.

describe("sale prices", () => {
  it("reads prices as people type them, with cents", () => {
    expect(parsePrice("1.5")).toBe("1.50");
    expect(parsePrice("$1,250")).toBe("1250.00");
    expect(parsePrice(" 500 ")).toBe("500.00");
    expect(parsePrice("1.505")).toBeNull();
    expect(parsePrice("-3")).toBeNull();
    expect(parsePrice("uno")).toBeNull();
  });

  it("a box with its own price sells at it; without one, at content × unit", () => {
    // Box of 500 screws at $500, loose screw at $1.50.
    expect(effectivePrice("500", "1.50", "500")?.toFixed(2)).toBe("500.00");
    expect(effectivePrice(null, "1.50", "500")?.toFixed(2)).toBe("750.00");
    expect(effectivePrice(null, "0.333", "3")?.toFixed(2)).toBe("1.00");
    expect(effectivePrice(null, null, "500")).toBeNull();
  });

  it("writes money with cents and thousands", () => {
    expect(formatMoney("1250")).toBe("$1,250.00");
    expect(formatMoney("0.5")).toBe("$0.50");
  });
});
