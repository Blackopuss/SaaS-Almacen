import { afterAll, afterEach, describe, expect, it } from "vitest";

import { dec, newId } from "@/lib";
import {
  reconcileStock,
  reconcileValue,
  registerEntry,
} from "@/modules/inventory";
import {
  acceptQuote,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getMyCashSession,
  getQuote,
  getQuoteReport,
  getSalesOrder,
  getSalesReport,
  markQuoteSent,
  recordCashMovement,
  returnSale,
  setSalePrices,
  updateSalesSettings,
} from "@/modules/sales";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-12 (ADR 0030): quote → order → partial delivery → charge, end to
// end. At the close, stock and its value, the register, the sales report,
// the order and the quote report all tell the same story.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

const money = (text: string) => dec(text.replace(/[$,]/g, ""));

describe("from quote to cash", () => {
  it("adds up everywhere", async () => {
    const titular = await salesCompany();
    // VAT added on top of the prices, 16 %.
    expect(
      await updateSalesSettings(titular, { taxMode: "added", taxRate: "16" }),
    ).toMatchObject({ ok: true });
    const cement = await createProduct(titular, {
      sku: "CEM-1",
      name: "Cemento",
    });
    const rebar = await createProduct(titular, {
      sku: "VAR-3",
      name: "Varilla 3/8",
    });
    if (!cement.ok || !rebar.ok) throw new Error("product setup failed");
    const bundle = await createPresentation(titular, rebar.productId, {
      name: "Paquete",
      factor: "10",
    });
    if (!bundle.ok) throw new Error("presentation setup failed");
    await registerEntry(titular, {
      productId: cement.productId,
      quantity: "10",
      unitCost: "150",
    });
    await registerEntry(titular, {
      productId: rebar.productId,
      quantity: "50",
      unitCost: "20",
    });
    await setSalePrices(titular, cement.productId, {
      unitPrice: "200",
      presentations: {},
    });
    await setSalePrices(titular, rebar.productId, {
      unitPrice: "30",
      presentations: { [bundle.presentationId]: "280" },
    });

    // The Cajero quotes, with the 5 % her role gives.
    const cajera = await salesMember(titular.organizationId, "cashier");
    const customer = await createCustomer(cajera, { name: "Obra Lomas" });
    if (!customer.ok) throw new Error("customer setup failed");
    const quote = await createQuote(cajera, {
      customerId: customer.customer.id,
      discount: { percent: "5", reason: "Cliente frecuente" },
      lines: [
        { productId: cement.productId, capture: "base", quantity: "5" },
        {
          productId: rebar.productId,
          capture: `p:${bundle.presentationId}`,
          quantity: "3",
        },
      ],
    });
    if (!quote.ok) throw new Error("quote failed");
    // 950 + 798 = 1,748 + 16 % = 2,027.68.
    expect((await getQuote(cajera, quote.quoteId))?.total).toBe("$2,027.68");
    await markQuoteSent(cajera, quote.quoteId);
    await acceptQuote(cajera, quote.quoteId);
    const order = await convertQuoteToOrder(cajera, quote.quoteId);
    if (!order.ok) throw new Error("order failed");
    // Prices go up after the customer accepted: the order keeps them.
    await setSalePrices(titular, cement.productId, {
      unitPrice: "250",
      presentations: {},
    });
    const lines = await db.salesOrderLine.findMany({
      where: { orderId: order.orderId },
      orderBy: { lineNumber: "asc" },
    });
    const [cementLine, rebarLine] = lines as [
      (typeof lines)[number],
      (typeof lines)[number],
    ];

    // First delivery: all the cement and 2 of the 3 bundles, in cash.
    const first = await fulfillSalesOrder(cajera, order.orderId, {
      lines: [
        { orderLineId: cementLine.id, quantity: "5" },
        { orderLineId: rebarLine.id, quantity: "2" },
      ],
      payments: [{ method: "CASH", received: "2000" }],
      idempotencyKey: newId(),
    });
    // 950 + 532 = 1,482 + 237.12.
    expect(first).toMatchObject({
      ok: true,
      total: "$1,719.12",
      change: "$280.88",
      fulfilled: false,
    });
    // Second: the last bundle, by card.
    const second = await fulfillSalesOrder(cajera, order.orderId, {
      lines: [{ orderLineId: rebarLine.id, quantity: "1" }],
      payments: [{ method: "CARD", reference: "AUT-4410" }],
      idempotencyKey: newId(),
    });
    expect(second).toMatchObject({
      ok: true,
      total: "$308.56",
      fulfilled: true,
    });
    if (!first.ok || !second.ok) return;

    // The order adds up to what was accepted, delivered in two sales.
    const view = await getSalesOrder(titular, order.orderId);
    expect(view).toMatchObject({ status: "FULFILLED", total: "$2,027.68" });
    expect(
      view!.sales.reduce((sum, sale) => sum.plus(money(sale.total)), dec(0)),
    ).toEqual(money("$2,027.68"));

    // A bag of cement comes back; the order stays delivered.
    const encargado = await salesMember(titular.organizationId, "cash_manager");
    // Change from the bank, so there is cash to give back.
    await recordCashMovement(encargado, {
      direction: "IN",
      amount: "500",
      reason: "Cambio del banco",
    });
    const firstCement = await db.saleLine.findFirstOrThrow({
      where: { saleId: first.saleId, orderLineId: cementLine.id },
    });
    const back = await returnSale(encargado, first.saleId, {
      lines: [{ saleLineId: firstCement.id, quantity: "1" }],
      reason: "Bulto roto",
      refundMethod: "CASH",
      idempotencyKey: newId(),
    });
    if (!back.ok) throw new Error("return failed");
    expect((await getSalesOrder(titular, order.orderId))?.status).toBe(
      "FULFILLED",
    );

    // Stock and its value agree with the history.
    expect(await reconcileStock(titular.organizationId)).toEqual([]);
    expect(await reconcileValue(titular.organizationId)).toEqual([]);
    const balances = await db.stockBalance.findMany({
      where: { organizationId: titular.organizationId },
      select: { productId: true, quantity: true },
    });
    const held = (productId: string) =>
      balances
        .filter((b) => b.productId === productId)
        .reduce((sum, b) => sum.plus(b.quantity.toString()), dec(0))
        .toString();
    expect(held(cement.productId)).toBe("6");
    expect(held(rebar.productId)).toBe("20");

    // The register of who charged: cash and card as they came in.
    expect((await getMyCashSession(cajera))?.totals).toMatchObject({
      cashSales: "$1,719.12",
      card: "$308.56",
      expectedCash: "$1,719.12",
    });
    // The refund came out of the register of who gave it back.
    expect((await getMyCashSession(encargado))?.totals).toMatchObject({
      cashRefunds: back.refund,
    });

    // The sales report: what the customer paid, minus what went back.
    const report = await getSalesReport(titular);
    if (!report.ok) throw new Error("report failed");
    expect(report.sales).toBe(2);
    expect(money(report.total.text)).toEqual(
      money("$2,027.68").minus(money(back.refund)),
    );

    // And the quote report: one sent, one accepted, nothing pending.
    expect(await getQuoteReport(titular)).toMatchObject({
      ok: true,
      sent: { count: 1, total: "$2,027.68" },
      conversion: "100 %",
      pendingQuotes: { count: 0 },
      pendingOrders: { count: 0 },
    });
  });
});
