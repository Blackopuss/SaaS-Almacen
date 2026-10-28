import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib";
import {
  acceptQuote,
  convertQuoteToOrder,
  createQuote,
  getQuote,
  getSalesOrder,
  listSalesOrders,
  markQuoteSent,
  rejectQuote,
  setSalePrices,
} from "@/modules/sales";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-05 (ADR 0030): an accepted quote becomes its order with the prices
// the customer accepted; once, and nothing of it changes afterwards.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

async function quote() {
  const titular = await salesCompany();
  const product = await createProduct(titular, {
    sku: "P-1",
    name: "Tornillo",
  });
  if (!product.ok) throw new Error("product setup failed");
  const box = await createPresentation(titular, product.productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  await setSalePrices(titular, product.productId, {
    unitPrice: "1.50",
    presentations: { [box.presentationId]: "500" },
  });
  const customer = await createCustomer(titular, { name: "Obra Sur" });
  if (!customer.ok) throw new Error("customer setup failed");
  const created = await createQuote(titular, {
    customerId: customer.customer.id,
    notes: "Entrega el lunes",
    discount: { percent: "5", reason: "Mayoreo" },
    lines: [
      {
        productId: product.productId,
        capture: `p:${box.presentationId}`,
        quantity: "2",
      },
      { productId: product.productId, capture: "base", quantity: "3" },
    ],
  });
  if (!created.ok) throw new Error("quote setup failed");
  return {
    titular,
    quoteId: created.quoteId,
    productId: product.productId,
    boxId: box.presentationId,
  };
}

describe("converting a quote into an order", () => {
  it("copies what was accepted, even after the prices change", async () => {
    const { titular, quoteId, productId, boxId } = await quote();
    await markQuoteSent(titular, quoteId);
    await acceptQuote(titular, quoteId);
    const before = await getQuote(titular, quoteId);
    // The price changes after the customer accepted: the order keeps theirs.
    await setSalePrices(titular, productId, {
      unitPrice: "2",
      presentations: { [boxId]: "650" },
    });
    const result = await convertQuoteToOrder(titular, quoteId);
    expect(result).toEqual({
      ok: true,
      orderId: expect.any(String),
      number: 1,
    });
    if (!result.ok) return;
    const order = await getSalesOrder(titular, result.orderId);
    expect(order).toMatchObject({
      number: 1,
      status: "OPEN",
      statusLabel: "Por surtir",
      quote: { id: quoteId, number: 1 },
      customer: { name: "Obra Sur" },
      notes: "Entrega el lunes",
      total: before!.total,
      discount: { reason: "Mayoreo" },
    });
    expect(
      order!.lines.map((line) => [line.quantityText, line.unitPrice]),
    ).toEqual([
      ["2 cajas de 500 piezas", "$500.00 c/u"],
      ["3 piezas", "$1.50 c/u"],
    ]);
    expect((await getQuote(titular, quoteId))?.order).toEqual({
      id: result.orderId,
      number: 1,
    });
    // Nothing left stock.
    expect(
      await db.stockMovement.count({
        where: { organizationId: titular.organizationId, type: "SALE" },
      }),
    ).toBe(0);
    expect((await listSalesOrders(titular)).items).toMatchObject([
      { number: 1, quoteNumber: 1, customer: "Obra Sur", total: before!.total },
    ]);
  });

  it("once: converting again, or twice at once, gives the same order", async () => {
    const { titular, quoteId } = await quote();
    await markQuoteSent(titular, quoteId);
    await acceptQuote(titular, quoteId);
    const [first, second] = await Promise.all([
      convertQuoteToOrder(titular, quoteId),
      convertQuoteToOrder(titular, quoteId),
    ]);
    expect(first.ok && second.ok && first.orderId === second.orderId).toBe(
      true,
    );
    expect(await convertQuoteToOrder(titular, quoteId)).toMatchObject({
      ok: true,
      repeated: true,
    });
    expect(
      await db.salesOrder.count({
        where: { organizationId: titular.organizationId },
      }),
    ).toBe(1);
  });

  it("only an accepted quote", async () => {
    const { titular, quoteId } = await quote();
    expect(await convertQuoteToOrder(titular, quoteId)).toMatchObject({
      ok: false,
      reason: "invalid_state",
      error: expect.stringMatching(/Primero envía/),
    });
    await markQuoteSent(titular, quoteId);
    expect(await convertQuoteToOrder(titular, quoteId)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/márcala como aceptada|marca la cotización/),
    });
    await rejectQuote(titular, quoteId, "No le convenció");
    expect(await convertQuoteToOrder(titular, quoteId)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/rechazó/),
    });
  });

  it("what was agreed does not change in the database", async () => {
    const { titular, quoteId } = await quote();
    await markQuoteSent(titular, quoteId);
    await acceptQuote(titular, quoteId);
    const result = await convertQuoteToOrder(titular, quoteId);
    if (!result.ok) throw new Error("conversion failed");
    await expect(
      db.salesOrder.update({
        where: { id: result.orderId },
        data: { notes: "Otra cosa" },
      }),
    ).rejects.toThrow(/cannot change/);
    const line = await db.salesOrderLine.findFirstOrThrow({
      where: { orderId: result.orderId },
    });
    await expect(
      db.salesOrderLine.update({
        where: { id: line.id },
        data: { unitPrice: "1", amount: "2" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.salesOrder.delete({ where: { id: result.orderId } }),
    ).rejects.toThrow(/cannot be deleted/);
  });

  it("who may: Consulta reads orders, Almacén does not; other companies neither", async () => {
    const { titular, quoteId } = await quote();
    await markQuoteSent(titular, quoteId);
    await acceptQuote(titular, quoteId);
    const consulta = await salesMember(titular.organizationId, "viewer");
    await expect(convertQuoteToOrder(consulta, quoteId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const cajera = await salesMember(titular.organizationId, "cashier");
    const result = await convertQuoteToOrder(cajera, quoteId);
    if (!result.ok) throw new Error("conversion failed");
    expect((await getSalesOrder(consulta, result.orderId))?.number).toBe(1);
    const almacen = await salesMember(titular.organizationId, "warehouse");
    await expect(getSalesOrder(almacen, result.orderId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const other = await salesCompany();
    expect(await getSalesOrder(other, result.orderId)).toBeNull();
    expect(await convertQuoteToOrder(other, quoteId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });
});
