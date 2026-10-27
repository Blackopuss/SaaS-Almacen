import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  getSaleProduct,
  quoteSale,
  setSalePrices,
  updateSalesSettings,
} from "@/modules/sales";
import { createPresentation, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-06/07 (ADR 0030): the cart is priced in the server with the
// company's prices and VAT; a box at its own price, loose pieces at theirs,
// meters with decimals.

type Actor = { organizationId: string; userId: string };

let skus = 0;
async function screws(actor: Actor) {
  const created = await createProduct(actor, {
    sku: `T-${++skus}`,
    name: `Tornillo ${skus}`,
  });
  if (!created.ok) throw new Error("product setup failed");
  const box = await createPresentation(actor, created.productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  await registerEntry(actor, {
    productId: created.productId,
    quantity: "1000",
    unitCost: "0.90",
  });
  await setSalePrices(actor, created.productId, {
    unitPrice: "1.50",
    presentations: { [box.presentationId]: "500" },
  });
  return { productId: created.productId, boxId: box.presentationId };
}

async function cable(actor: Actor) {
  const created = await createProduct(actor, {
    sku: `C-${++skus}`,
    name: `Cable ${skus}`,
    unit: "m",
    step: "0.01",
  });
  if (!created.ok) throw new Error("product setup failed");
  await registerEntry(actor, { productId: created.productId, quantity: "100" });
  await setSalePrices(actor, created.productId, {
    unitPrice: "12.50",
    presentations: {},
  });
  return created.productId;
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("cart", () => {
  it("prices a box at its own price and loose pieces at theirs, VAT included", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const quote = await quoteSale(actor, {
      lines: [
        { productId, capture: `p:${boxId}`, quantity: "1" },
        { productId, capture: "base", quantity: "3" },
      ],
    });
    expect(quote).toEqual({
      lines: [
        { unitPrice: "$500.00", amount: "$500.00" },
        { unitPrice: "$1.50", amount: "$4.50" },
      ],
      // 504.50 / 1.16 = 434.913… → 434.91; the VAT is the rest.
      subtotal: "$434.91",
      tax: "$69.59",
      total: "$504.50",
      taxLabel: "IVA incluido (16 %)",
      pricesIncludeTax: true,
      paymentNote: null,
    });
  });

  it("2.75 m of cable and VAT added on top (VEN-07)", async () => {
    const actor = await salesCompany();
    const productId = await cable(actor);
    await updateSalesSettings(actor, { taxMode: "added", taxRate: "16" });
    const quote = await quoteSale(actor, {
      lines: [{ productId, capture: "base", quantity: "2.75" }],
    });
    // 2.75 × 12.50 = 34.375 → $34.38; VAT 5.5008 → $5.50.
    expect(quote).toMatchObject({
      lines: [{ unitPrice: "$12.50", amount: "$34.38" }],
      subtotal: "$34.38",
      tax: "$5.50",
      total: "$39.88",
      taxLabel: "IVA (16 %)",
    });
  });

  it("a box without its own price sells at its content × the piece price", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    await setSalePrices(actor, productId, {
      unitPrice: "1.50",
      presentations: { [boxId]: "" },
    });
    const quote = await quoteSale(actor, {
      lines: [{ productId, capture: `p:${boxId}`, quantity: "1" }],
    });
    expect(quote.lines[0]).toEqual({
      unitPrice: "$750.00",
      amount: "$750.00",
    });
  });

  it("says what cannot be sold, and leaves it out of the total", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const noPrice = await createProduct(actor, { sku: "SP-1", name: "Pala" });
    if (!noPrice.ok) throw new Error("product setup failed");
    const quote = await quoteSale(actor, {
      lines: [
        { productId, capture: "base", quantity: "2" },
        { productId: noPrice.productId, capture: "base", quantity: "1" },
        { productId, capture: "base", quantity: "1.5" },
        { productId, capture: "u:cm", quantity: "1" },
        // Two boxes (1,000) plus the two loose pieces above: more than
        // there is.
        { productId, capture: `p:${boxId}`, quantity: "2" },
      ],
    });
    expect(quote.lines.map((line) => line.error)).toEqual([
      expect.stringMatching(/Solo hay 1,000 piezas/),
      expect.stringMatching(/no tiene precio de venta/),
      expect.any(String),
      expect.stringMatching(/pieza o presentación/),
      expect.stringMatching(/Solo hay 1,000 piezas/),
    ]);
    // Priced lines still add up, so the cashier sees the amount.
    expect(quote.total).toBe("$1,003.00");
  });

  it("the cashier sells; whoever only looks does not", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const cajero = await salesMember(actor.organizationId, "cashier");
    expect(
      (
        await quoteSale(cajero, {
          lines: [{ productId, capture: "base", quantity: "1" }],
        })
      ).total,
    ).toBe("$1.50");
    expect(await getSaleProduct(cajero, productId)).toMatchObject({
      captures: [
        { value: "base", label: "Pieza", price: "$1.50" },
        { value: `p:${boxId}`, label: "Caja = 500 piezas", price: "$500.00" },
      ],
      locations: [{ label: expect.stringMatching(/hay 1,000 piezas/) }],
    });
    const consulta = await salesMember(actor.organizationId, "viewer");
    await expect(quoteSale(consulta, { lines: [] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("does not reach another company's products", async () => {
    const actor = await salesCompany();
    const other = await salesCompany();
    const { productId } = await screws(other);
    expect(await getSaleProduct(actor, productId)).toBeNull();
    const quote = await quoteSale(actor, {
      lines: [{ productId, capture: "base", quantity: "1" }],
    });
    expect(quote.lines[0]?.error).toMatch(/ya no existe/);
    expect(quote.total).toBe("$0.00");
  });
});
