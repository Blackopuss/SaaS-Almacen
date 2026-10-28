import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  reconcileStock,
  reconcileValue,
  registerEntry,
} from "@/modules/inventory";
import {
  acceptQuote,
  addMonths,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getMyCashSession,
  getOrderToFulfill,
  getReceivableOfSale,
  getSalesOrder,
  markQuoteSent,
  previewFulfillment,
  returnSale,
  setInstallmentTerms,
  setSalePrices,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// PAG-04 (ADR 0030): a sale on installments leaves stock when the down
// payment is charged; in the same transaction its account is born, with
// the calendar agreed in the quote.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * Two $10,000 fridges that cost $6,000 each, on 6 months with 10 %:
 * down payment $12,000, then $8,000 + $800 in 6 payments.
 */
async function order() {
  const titular = await salesCompany();
  const product = await createProduct(titular, {
    sku: "REF-1",
    name: "Refrigerador",
  });
  if (!product.ok) throw new Error("product setup failed");
  await registerEntry(titular, {
    productId: product.productId,
    quantity: "5",
    unitCost: "6000",
  });
  await setSalePrices(titular, product.productId, {
    unitPrice: "10000",
    presentations: {},
  });
  await setInstallmentTerms(titular, [{ months: "6", interest: "10" }]);
  const customer = await createCustomer(titular, { name: "Laura Núñez" });
  if (!customer.ok) throw new Error("customer setup failed");
  const cajera = await salesMember(titular.organizationId, "cashier");
  const quote = await createQuote(cajera, {
    customerId: customer.customer.id,
    lines: [{ productId: product.productId, capture: "base", quantity: "2" }],
    plan: { months: "6", downPayment: "12000" },
  });
  if (!quote.ok) throw new Error("quote setup failed");
  await markQuoteSent(cajera, quote.quoteId);
  await acceptQuote(cajera, quote.quoteId);
  const converted = await convertQuoteToOrder(cajera, quote.quoteId);
  if (!converted.ok) throw new Error("order setup failed");
  const line = await db.salesOrderLine.findFirstOrThrow({
    where: { orderId: converted.orderId },
  });
  return { titular, cajera, orderId: converted.orderId, lineId: line.id };
}

describe("sale on installments", () => {
  it("charges the down payment, leaves stock and opens the account", async () => {
    const { titular, cajera, orderId, lineId } = await order();
    // The order keeps the plan agreed.
    expect((await getSalesOrder(cajera, orderId))?.plan).toMatchObject({
      months: 6,
      downPayment: "$12,000.00",
      installment: "$1,466.66",
    });
    const screen = await getOrderToFulfill(cajera, orderId);
    expect(screen?.plan).toMatchObject({ months: 6 });
    expect(screen?.lines.map((line) => line.suggested)).toEqual(["2"]);

    // Never in parts.
    expect(
      await fulfillSalesOrder(cajera, orderId, {
        lines: [{ orderLineId: lineId, quantity: "1" }],
        payments: [{ method: "CASH", received: "12000" }],
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/se entrega completo/),
    });
    // Today only the down payment is charged.
    expect(
      await previewFulfillment(cajera, orderId, {
        lines: [{ orderLineId: lineId, quantity: "2" }],
        payments: [{ method: "CASH", received: "12500" }],
      }),
    ).toMatchObject({
      total: "$20,000.00",
      charge: "$12,000.00",
      paymentNote: "Cambio: $500.00",
    });
    const key = newId();
    const done = await fulfillSalesOrder(cajera, orderId, {
      lines: [{ orderLineId: lineId, quantity: "2" }],
      payments: [{ method: "CASH", received: "12500" }],
      idempotencyKey: key,
    });
    expect(done).toMatchObject({
      ok: true,
      total: "$20,000.00",
      charged: "$12,000.00",
      change: "$500.00",
      fulfilled: true,
    });
    if (!done.ok) return;
    // A retry answers with the same sale.
    expect(
      await fulfillSalesOrder(cajera, orderId, {
        lines: [{ orderLineId: lineId, quantity: "2" }],
        payments: [{ method: "CASH", received: "12500" }],
        idempotencyKey: key,
      }),
    ).toMatchObject({ ok: true, saleId: done.saleId, repeated: true });

    // The account: what is owed, on its calendar.
    const account = await getReceivableOfSale(cajera, done.saleId);
    expect(account).toMatchObject({
      number: 1,
      statusLabel: "Por cobrar",
      downPayment: "$12,000.00",
      financed: "$8,000.00",
      interest: "$800.00",
      owed: "$8,800.00",
      months: 6,
    });
    expect(account!.installments.map((i) => i.amount)).toEqual([
      "$1,466.66",
      "$1,466.66",
      "$1,466.66",
      "$1,466.66",
      "$1,466.66",
      "$1,466.70",
    ]);
    expect(account!.installments[0]!.dueDay).toBe(addMonths(today(), 1));
    expect(account!.installments[5]!.dueDay).toBe(addMonths(today(), 6));

    // The register got the down payment, not the whole sale.
    expect((await getMyCashSession(cajera))?.totals).toMatchObject({
      cashSales: "$12,000.00",
    });
    expect(await reconcileStock(titular.organizationId)).toEqual([]);
    expect(await reconcileValue(titular.organizationId)).toEqual([]);

    // Returns of a sale on installments wait for their rules (PAG-08).
    const encargado = await salesMember(titular.organizationId, "cash_manager");
    const saleLine = await db.saleLine.findFirstOrThrow({
      where: { saleId: done.saleId },
    });
    expect(
      await returnSale(encargado, done.saleId, {
        lines: [{ saleLineId: saleLine.id, quantity: "1" }],
        reason: "No enfría",
        refundMethod: "CASH",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/es a plazos/),
    });
  });

  it("a cash sale has no account; another company sees nothing", async () => {
    const { cajera, orderId, lineId } = await order();
    const done = await fulfillSalesOrder(cajera, orderId, {
      lines: [{ orderLineId: lineId, quantity: "2" }],
      payments: [{ method: "CARD", reference: "AUT-1" }],
      idempotencyKey: newId(),
    });
    if (!done.ok) throw new Error("delivery failed");
    expect(
      await getReceivableOfSale(await salesCompany(), done.saleId),
    ).toBeNull();
    const cashSale = await db.sale.findFirst({
      where: { organizationId: cajera.organizationId, salesOrderId: null },
    });
    expect(cashSale).toBeNull();
  });

  it("the database keeps the account as it was born", async () => {
    const { cajera, orderId, lineId } = await order();
    const done = await fulfillSalesOrder(cajera, orderId, {
      lines: [{ orderLineId: lineId, quantity: "2" }],
      payments: [{ method: "CASH", received: "12000" }],
      idempotencyKey: newId(),
    });
    if (!done.ok) throw new Error("delivery failed");
    const account = await db.salesReceivable.findFirstOrThrow({
      where: { saleId: done.saleId },
      include: { installments: true },
    });
    await expect(
      db.salesReceivable.update({
        where: { id: account.id },
        data: { owed: "1" },
      }),
    ).rejects.toThrow(/only its status changes|sales_receivable_check/);
    await expect(
      db.salesReceivableInstallment.update({
        where: { id: account.installments[0]!.id },
        data: { amount: "1" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.salesReceivable.delete({ where: { id: account.id } }),
    ).rejects.toThrow(/cannot be deleted/);
    // The order's plan does not change either.
    await expect(
      db.salesOrder.update({
        where: { id: orderId },
        data: { downPayment: "1" },
      }),
    ).rejects.toThrow(/what was agreed cannot change/);
  });
});
