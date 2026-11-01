import { describe, expect, it } from "vitest";

import { formatTaxRate, parseTaxRate, saleTotals, type TaxRule } from "./tax";

const included: TaxRule = { pricesIncludeTax: true, rate: "16.00" };
const added: TaxRule = { pricesIncludeTax: false, rate: "16.00" };

const plain = (totals: ReturnType<typeof saleTotals>) => ({
  subtotal: totals.subtotal.toFixed(2),
  tax: totals.tax.toFixed(2),
  total: totals.total.toFixed(2),
});

describe("saleTotals", () => {
  it("breaks VAT out of prices that include it", () => {
    expect(plain(saleTotals(["116"], included))).toEqual({
      subtotal: "100.00",
      tax: "16.00",
      total: "116.00",
    });
  });

  it("adds VAT to prices that do not include it", () => {
    expect(plain(saleTotals(["100"], added))).toEqual({
      subtotal: "100.00",
      tax: "16.00",
      total: "116.00",
    });
  });

  it("rounds once, on the whole sale, half up to cents", () => {
    // Per line it would be 0.02 × 3 = 0.06; on the sale, 0.048 → 0.05.
    expect(plain(saleTotals(["0.10", "0.10", "0.10"], added))).toEqual({
      subtotal: "0.30",
      tax: "0.05",
      total: "0.35",
    });
    // $1.00 with VAT: 1 / 1.16 = 0.862… → 0.86 and the VAT is the rest.
    expect(plain(saleTotals(["1.00"], included))).toEqual({
      subtotal: "0.86",
      tax: "0.14",
      total: "1.00",
    });
  });

  it("subtotal + VAT is always the total", () => {
    for (const amount of ["0.01", "1.50", "33.33", "500", "1234.57"]) {
      for (const rule of [included, added]) {
        const totals = saleTotals([amount, "0.99"], rule);
        expect(totals.subtotal.plus(totals.tax).equals(totals.total)).toBe(
          true,
        );
      }
    }
  });

  it("works with other rates and with none", () => {
    expect(
      plain(saleTotals(["108"], { pricesIncludeTax: true, rate: "8" })),
    ).toEqual({ subtotal: "100.00", tax: "8.00", total: "108.00" });
    expect(
      plain(saleTotals(["99.99"], { pricesIncludeTax: false, rate: "0" })),
    ).toEqual({ subtotal: "99.99", tax: "0.00", total: "99.99" });
  });

  it("an empty sale is zero", () => {
    expect(plain(saleTotals([], added))).toEqual({
      subtotal: "0.00",
      tax: "0.00",
      total: "0.00",
    });
  });
});

describe("parseTaxRate", () => {
  it.each([
    ["16", "16.00"],
    ["8.5", "8.50"],
    ["0", "0.00"],
    ["16 %", "16.00"],
    ["100", "100.00"],
  ])("reads %j", (text, rate) => {
    expect(parseTaxRate(text)).toBe(rate);
  });

  it.each(["", "-1", "101", "16.005", "dieciséis", "1e2", "16,5"])(
    "refuses %j",
    (text) => {
      expect(parseTaxRate(text)).toBeNull();
    },
  );

  it("shows the rate without trailing zeros", () => {
    expect(formatTaxRate("16.00")).toBe("16 %");
    expect(formatTaxRate("8.50")).toBe("8.5 %");
  });
});
