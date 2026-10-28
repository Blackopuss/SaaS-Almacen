import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  acceptQuote,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getQuoteReport,
  markQuoteSent,
  rejectQuote,
  setSalePrices,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-11: how many quotes became sales, and what is pending today.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("quote report", () => {
  it("counts conversion by quotes and by amount, and what is pending", async () => {
    const actor = await salesCompany();
    const product = await createProduct(actor, { sku: "P-1", name: "Pala" });
    if (!product.ok) throw new Error("product setup failed");
    await registerEntry(actor, {
      productId: product.productId,
      quantity: "100",
      unitCost: "50",
    });
    await setSalePrices(actor, product.productId, {
      unitPrice: "100",
      presentations: {},
    });
    const customer = await createCustomer(actor, { name: "Obra Norte" });
    if (!customer.ok) throw new Error("customer setup failed");
    // Four quotes of 1, 2, 3 and 4 shovels ($100 each, VAT included).
    const ids: string[] = [];
    for (const quantity of ["1", "2", "3", "4"]) {
      const quote = await createQuote(actor, {
        customerId: customer.customer.id,
        lines: [{ productId: product.productId, capture: "base", quantity }],
      });
      if (!quote.ok) throw new Error("quote setup failed");
      ids.push(quote.quoteId);
    }
    const [, waiting, rejected, accepted] = ids as [
      string,
      string,
      string,
      string,
    ];
    for (const id of [waiting, rejected, accepted]) {
      await markQuoteSent(actor, id);
    }
    await rejectQuote(actor, rejected, "Muy caro");
    await acceptQuote(actor, accepted);
    const order = await convertQuoteToOrder(actor, accepted);
    if (!order.ok) throw new Error("order failed");
    const line = await db.salesOrderLine.findFirstOrThrow({
      where: { orderId: order.orderId },
    });
    // One of the four shovels delivered: three still missing.
    await fulfillSalesOrder(actor, order.orderId, {
      lines: [{ orderLineId: line.id, quantity: "1" }],
      payments: [{ method: "CASH", received: "100" }],
      idempotencyKey: newId(),
    });

    const report = await getQuoteReport(actor);
    expect(report).toMatchObject({
      ok: true,
      made: { count: 4, total: "$1,000.00" },
      drafts: { count: 1, total: "$100.00" },
      sent: { count: 3, total: "$900.00" },
      waiting: { count: 1, total: "$200.00" },
      rejected: { count: 1, total: "$300.00" },
      accepted: { count: 1, total: "$400.00" },
      expired: { count: 0 },
      // 1 of 3 sent; $400 of $900.
      conversion: "33 %",
      conversionByAmount: "44 %",
      pendingQuotes: { count: 1, total: "$200.00" },
      pendingOrders: { count: 1, total: "$300.00" },
      truncated: false,
    });
  });

  it("an empty period has no conversion; bad dates are said; only who sees reports", async () => {
    const actor = await salesCompany();
    expect(await getQuoteReport(actor)).toMatchObject({
      ok: true,
      made: { count: 0, total: "$0.00" },
      conversion: null,
      conversionByAmount: null,
    });
    expect(
      await getQuoteReport(actor, { from: "2026-10-20", to: "2026-10-01" }),
    ).toMatchObject({ ok: false });
    const cajera = await salesMember(actor.organizationId, "cashier");
    await expect(getQuoteReport(cajera)).rejects.toBeInstanceOf(ForbiddenError);
    const consulta = await salesMember(actor.organizationId, "viewer");
    expect(await getQuoteReport(consulta)).toMatchObject({ ok: true });
  });
});
