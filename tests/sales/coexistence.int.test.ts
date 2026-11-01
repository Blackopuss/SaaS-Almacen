import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  cancelSale,
  countSalesBetween,
  registerSale,
  setSalePrices,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany } from "../setup/sales";

// VEN-25 (ADR 0030): a company that charges in Ventas and also imports
// exits from another system is warned of the sales of the same days, so
// the same sale does not leave the stock twice.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

describe("sales of the days of an import", () => {
  it("counts the sales charged those days, not the cancelled ones", async () => {
    const titular = await salesCompany();
    const created = await createProduct(titular, { sku: "C-1", name: "Clavo" });
    if (!created.ok) throw new Error("product setup failed");
    const productId = created.productId;
    await registerEntry(titular, { productId, quantity: "10" });
    await setSalePrices(titular, productId, {
      unitPrice: "2",
      presentations: {},
    });
    const sell = async () => {
      const sale = await registerSale(titular, {
        lines: [{ productId, capture: "base", quantity: "1" }],
        payments: [{ method: "CASH" }],
        idempotencyKey: newId(),
      });
      if (!sale.ok) throw new Error("sale failed");
      return sale.saleId;
    };
    await sell();
    const second = await sell();
    await cancelSale(titular, second, {
      reason: "Error",
      refundMethod: "CASH",
      idempotencyKey: newId(),
    });

    const day = today();
    expect(await countSalesBetween(titular, day, day)).toBe(1);
    expect(await countSalesBetween(titular, "2020-01-01", "2020-01-31")).toBe(
      0,
    );
    expect(await countSalesBetween(titular, "no es un día", day)).toBe(0);
    // Another company's sales never count.
    expect(await countSalesBetween(await salesCompany(), day, day)).toBe(0);
  });
});
