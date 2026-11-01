import { afterAll, afterEach, describe, expect, it } from "vitest";

import { dec, newId } from "@/lib";
import {
  reconcileStock,
  reconcileValue,
  registerEntry,
} from "@/modules/inventory";
import {
  acceptQuote,
  closeCashSession,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getMyCashSession,
  getPortfolioReport,
  getReceivable,
  getSalesReport,
  markQuoteSent,
  registerReceivablePayment,
  returnSale,
  setInstallmentTerms,
  setSalePrices,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// PAG-09 (ADR 0030): a whole cycle of a sale on installments — quote with
// a plan, the order, the down payment, payments, a return and paying off
// early — reconciles the register, the stock and its value, the sales
// report and the portfolio.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

const money = (text: string) => text.replace(/[$,]/g, "");

describe("a sale on installments, start to end", () => {
  it("reconciles register, stock and portfolio", async () => {
    const titular = await salesCompany();
    const item = async (
      sku: string,
      name: string,
      price: string,
      cost: string,
    ) => {
      const product = await createProduct(titular, { sku, name });
      if (!product.ok) throw new Error("product setup failed");
      await registerEntry(titular, {
        productId: product.productId,
        quantity: "3",
        unitCost: cost,
      });
      await setSalePrices(titular, product.productId, {
        unitPrice: price,
        presentations: {},
      });
      return product.productId;
    };
    const fridge = await item("REF-1", "Refrigerador", "10000", "6000");
    const bracket = await item("SOP-1", "Soporte", "1000", "600");
    await setInstallmentTerms(titular, [{ months: "4", interest: "10" }]);
    const customer = await createCustomer(titular, { name: "Laura Núñez" });
    if (!customer.ok) throw new Error("customer setup failed");
    const cajera = await salesMember(titular.organizationId, "cashier");
    const encargado = await salesMember(titular.organizationId, "cash_manager");

    // The quote with its plan: $11,000, $6,600 down, 4 × $1,210.
    const quote = await createQuote(cajera, {
      customerId: customer.customer.id,
      lines: [
        { productId: fridge, capture: "base", quantity: "1" },
        { productId: bracket, capture: "base", quantity: "1" },
      ],
      plan: { months: "4", downPayment: "6600" },
    });
    if (!quote.ok) throw new Error("quote failed");
    await markQuoteSent(cajera, quote.quoteId);
    await acceptQuote(cajera, quote.quoteId);
    const order = await convertQuoteToOrder(cajera, quote.quoteId);
    if (!order.ok) throw new Error("order failed");
    const orderLines = await db.salesOrderLine.findMany({
      where: { orderId: order.orderId },
    });
    const sale = await fulfillSalesOrder(cajera, order.orderId, {
      lines: orderLines.map((line) => ({
        orderLineId: line.id,
        quantity: "1",
      })),
      payments: [{ method: "CASH", received: "7000" }],
      idempotencyKey: newId(),
    });
    if (!sale.ok) throw new Error("sale failed");
    const account = await db.salesReceivable.findFirstOrThrow({
      where: { saleId: sale.saleId },
    });

    let portfolio = await getPortfolioReport(titular);
    expect(portfolio).toMatchObject({
      ok: true,
      owed: "$4,840.00",
      openAccounts: 1,
      overdue: "$0.00",
      sold: {
        count: 1,
        total: "$11,000.00",
        downPayments: "$6,600.00",
        interest: "$440.00",
      },
      collected: { count: 0, total: "$0.00" },
    });

    // Two payments, cash and card.
    for (const [method, extra] of [
      ["CASH", { received: "1210" }],
      ["CARD", { reference: "AUT-1" }],
    ] as const) {
      const paid = await registerReceivablePayment(cajera, account.id, {
        amount: "1210",
        method,
        ...extra,
        idempotencyKey: newId(),
      });
      expect(paid).toMatchObject({ ok: true });
    }

    // The bracket comes back: $1,000 + $40 off the debt, no money back.
    const lines = await db.saleLine.findMany({
      where: { saleId: sale.saleId },
    });
    const back = await returnSale(encargado, sale.saleId, {
      lines: [
        {
          saleLineId: lines.find((l) => l.productId === bracket)!.id,
          quantity: "1",
        },
      ],
      reason: "No le sirvió",
      refundMethod: "",
      idempotencyKey: newId(),
    });
    expect(back).toMatchObject({
      ok: true,
      refund: "$0.00",
      credited: "$1,040.00",
    });

    portfolio = await getPortfolioReport(titular);
    expect(portfolio).toMatchObject({
      owed: "$1,380.00",
      collected: {
        count: 2,
        total: "$2,420.00",
        cash: "$1,210.00",
        card: "$1,210.00",
      },
      credited: "$1,040.00",
    });

    // Paid off early by transfer: the account is settled.
    expect(
      await registerReceivablePayment(cajera, account.id, {
        amount: "1380",
        method: "TRANSFER",
        reference: "SPEI-1",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: true, settled: true });
    expect(await getReceivable(cajera, account.id)).toMatchObject({
      statusLabel: "Pagada",
      balance: "$0.00",
    });
    portfolio = await getPortfolioReport(titular);
    expect(portfolio).toMatchObject({
      owed: "$0.00",
      openAccounts: 0,
      collected: { count: 3, total: "$3,800.00", transfer: "$1,380.00" },
    });

    // The register: the down payment and the cash payment in cash; card
    // and transfer apart. The customer paid $6,600 + $3,800 = $10,400:
    // the fridge ($10,000) and its share of the interest ($400).
    const session = await getMyCashSession(cajera);
    expect(session?.totals).toMatchObject({
      cashSales: "$6,600.00",
      cashOnAccounts: "$1,210.00",
      card: "$1,210.00",
      transfer: "$1,380.00",
      expectedCash: "$7,810.00",
    });
    // Closed by whoever closes registers, counted as expected.
    expect(
      await closeCashSession(encargado, session!.id, {
        countedCash: "7810",
        countedCard: "1210",
        countedTransfer: "1380",
      }),
    ).toMatchObject({ ok: true });

    // The sales report: the fridge stays sold, the bracket came back.
    const report = await getSalesReport(titular);
    if (!report.ok) throw new Error("report failed");
    expect(report.sales).toBe(1);
    expect(money(report.total.text)).toBe("10000.00");

    // Stock: one fridge out, the bracket back; balances match history.
    const balances = await db.stockBalance.findMany({
      where: { organizationId: titular.organizationId },
      select: { productId: true, quantity: true },
    });
    const left = (productId: string) =>
      balances
        .filter((b) => b.productId === productId)
        .reduce((sum, b) => sum.plus(b.quantity.toString()), dec(0))
        .toString();
    expect(left(fridge)).toBe("2");
    expect(left(bracket)).toBe("3");
    expect(await reconcileStock(titular.organizationId)).toEqual([]);
    expect(await reconcileValue(titular.organizationId)).toEqual([]);

    // Another company's portfolio knows nothing of it.
    expect(await getPortfolioReport(await salesCompany())).toMatchObject({
      owed: "$0.00",
      openAccounts: 0,
      sold: { count: 0 },
      collected: { count: 0 },
    });
  });
});
