import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  NO_CASH_SESSION,
  SALE_KEY_REUSED,
  acceptQuote,
  convertQuoteToOrder,
  createQuote,
  findReceivablePaymentByKey,
  fulfillSalesOrder,
  getMyCashSession,
  getReceivable,
  getReceivablePayment,
  listReceivables,
  markQuoteSent,
  registerReceivablePayment,
  setInstallmentTerms,
  setSalePrices,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// PAG-05 (ADR 0030): payments to an account at the register; applied to
// the oldest installment, never more than owed, without duplicates, and
// counted in the register's close.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

/** A fridge of $10,000 sold with $6,000 down, 4 months without interest: $1,000 each. */
async function account() {
  const titular = await salesCompany();
  const product = await createProduct(titular, {
    sku: "REF-1",
    name: "Refrigerador",
  });
  if (!product.ok) throw new Error("product setup failed");
  await registerEntry(titular, {
    productId: product.productId,
    quantity: "2",
    unitCost: "6000",
  });
  await setSalePrices(titular, product.productId, {
    unitPrice: "10000",
    presentations: {},
  });
  await setInstallmentTerms(titular, [{ months: "4", interest: "" }]);
  const customer = await createCustomer(titular, { name: "Laura Núñez" });
  if (!customer.ok) throw new Error("customer setup failed");
  const cajera = await salesMember(titular.organizationId, "cashier");
  const quote = await createQuote(cajera, {
    customerId: customer.customer.id,
    lines: [{ productId: product.productId, capture: "base", quantity: "1" }],
    plan: { months: "4", downPayment: "6000" },
  });
  if (!quote.ok) throw new Error("quote setup failed");
  await markQuoteSent(cajera, quote.quoteId);
  await acceptQuote(cajera, quote.quoteId);
  const order = await convertQuoteToOrder(cajera, quote.quoteId);
  if (!order.ok) throw new Error("order setup failed");
  const line = await db.salesOrderLine.findFirstOrThrow({
    where: { orderId: order.orderId },
  });
  const sale = await fulfillSalesOrder(cajera, order.orderId, {
    lines: [{ orderLineId: line.id, quantity: "1" }],
    payments: [{ method: "CASH", received: "6000" }],
    idempotencyKey: newId(),
  });
  if (!sale.ok) throw new Error("sale setup failed");
  const receivable = await db.salesReceivable.findFirstOrThrow({
    where: { saleId: sale.saleId },
  });
  return { titular, cajera, receivableId: receivable.id };
}

describe("payments to an account", () => {
  it("cover the oldest installment first, and settle it", async () => {
    const { cajera, receivableId } = await account();
    const first = await registerReceivablePayment(cajera, receivableId, {
      amount: "1,500",
      method: "CASH",
      received: "2000",
      idempotencyKey: newId(),
    });
    expect(first).toMatchObject({
      ok: true,
      number: 1,
      amount: "$1,500.00",
      change: "$500.00",
      balance: "$2,500.00",
      settled: false,
    });
    let view = await getReceivable(cajera, receivableId);
    expect(view).toMatchObject({ paid: "$1,500.00", balance: "$2,500.00" });
    expect(view!.installments.map((i) => [i.number, i.left, i.status])).toEqual(
      [
        [1, "$0.00", "PAID"],
        [2, "$500.00", "PARTIAL"],
        [3, "$1,000.00", "DUE"],
        [4, "$1,000.00", "DUE"],
      ],
    );
    // Never more than what is owed.
    expect(
      await registerReceivablePayment(cajera, receivableId, {
        amount: "2500.01",
        method: "CARD",
        reference: "AUT-1",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { amount: "Solo debe $2,500.00: no se abona más." },
    });
    const last = await registerReceivablePayment(cajera, receivableId, {
      amount: "2500",
      method: "TRANSFER",
      reference: "SPEI-77",
      idempotencyKey: newId(),
    });
    expect(last).toMatchObject({
      ok: true,
      number: 2,
      balance: "$0.00",
      settled: true,
    });
    view = await getReceivable(cajera, receivableId);
    expect(view).toMatchObject({ statusLabel: "Pagada", balance: "$0.00" });
    expect(view!.payments.map((p) => [p.number, p.amount, p.method])).toEqual([
      [1, "$1,500.00", "CASH"],
      [2, "$2,500.00", "TRANSFER"],
    ]);
    expect(
      await registerReceivablePayment(cajera, receivableId, {
        amount: "1",
        method: "CASH",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, formError: "Esta cuenta ya está pagada." });
    // The receipt says what was paid and what was left right after.
    if (!first.ok) return;
    expect(await getReceivablePayment(cajera, first.paymentId)).toMatchObject({
      number: 1,
      amount: "$1,500.00",
      methodLabel: "Efectivo",
      received: "$2,000.00",
      change: "$500.00",
      balanceAfter: "$2,500.00",
      customer: "Laura Núñez",
    });
    // The register: the down payment as a sale, the payments on accounts.
    expect((await getMyCashSession(cajera))?.totals).toMatchObject({
      cashSales: "$6,000.00",
      cashOnAccounts: "$1,500.00",
      transfer: "$2,500.00",
      expectedCash: "$7,500.00",
    });
    expect((await listReceivables(cajera)).items).toEqual([]);
    expect(
      (await listReceivables(cajera, { open: false })).items,
    ).toMatchObject([{ customer: "Laura Núñez", statusLabel: "Pagada" }]);
  });

  it("once: a retry answers with the same payment; two at once never pay twice", async () => {
    const { cajera, receivableId } = await account();
    const key = newId();
    const sent = {
      amount: "4000",
      method: "CARD",
      reference: "AUT-9",
      idempotencyKey: key,
    };
    const first = await registerReceivablePayment(cajera, receivableId, sent);
    expect(
      await registerReceivablePayment(cajera, receivableId, sent),
    ).toMatchObject({ ...first, repeated: true });
    expect(
      await registerReceivablePayment(cajera, receivableId, {
        ...sent,
        amount: "1",
      }),
    ).toMatchObject({ ok: false, formError: SALE_KEY_REUSED });
    expect(await findReceivablePaymentByKey(cajera, key)).toMatchObject({
      receivableId,
    });

    // Another account, paid whole by two people at once: only one goes.
    const other = await account();
    const otra = await salesMember(other.titular.organizationId, "cashier");
    const results = await Promise.all(
      [other.cajera, otra].map((who) =>
        registerReceivablePayment(who, other.receivableId, {
          amount: "4000",
          method: "CASH",
          idempotencyKey: newId(),
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("who may: who charges, with the register open; no one of another company", async () => {
    const { titular, receivableId } = await account();
    const sent = () => ({
      amount: "100",
      method: "CASH",
      idempotencyKey: newId(),
    });
    const consulta = await salesMember(titular.organizationId, "viewer");
    await expect(
      registerReceivablePayment(consulta, receivableId, sent()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getReceivable(consulta, receivableId))?.number).toBe(1);
    const closed = await salesMember(titular.organizationId, "cashier", {
      openCash: false,
    });
    expect(
      await registerReceivablePayment(closed, receivableId, sent()),
    ).toMatchObject({ ok: false, formError: NO_CASH_SESSION });
    const other = await salesCompany();
    expect(
      await registerReceivablePayment(other, receivableId, sent()),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await getReceivable(other, receivableId)).toBeNull();
  });

  it("the database keeps a payment as it was taken", async () => {
    const { cajera, receivableId } = await account();
    const paid = await registerReceivablePayment(cajera, receivableId, {
      amount: "100",
      method: "CASH",
      idempotencyKey: newId(),
    });
    if (!paid.ok) throw new Error("payment failed");
    await expect(
      db.salesReceivablePayment.update({
        where: { id: paid.paymentId },
        data: { amount: "1" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.salesReceivablePayment.delete({ where: { id: paid.paymentId } }),
    ).rejects.toThrow(/immutable/);
  });
});
