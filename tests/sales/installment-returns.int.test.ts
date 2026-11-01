import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  reconcileStock,
  reconcileValue,
  registerEntry,
} from "@/modules/inventory";
import {
  acceptQuote,
  cancelSale,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getMyCashSession,
  getReceivable,
  getReturnableSale,
  listSales,
  markQuoteSent,
  recordCashMovement,
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

// PAG-08 (ADR 0030): paying off early, returning and cancelling a sale on
// installments. What comes back, with its share of the interest, comes off
// the debt; only what passes the balance is given back. Never a negative
// balance; cancelling gives back the down payment and the payments.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

let skus = 0;

/**
 * A $10,000 fridge and a $1,000 bracket (cost $6,000 and $600) on 4 months
 * with 10 %: $6,600 down, $4,400 + $440 interest = $4,840, $1,210 a month.
 */
async function sold() {
  const titular = await salesCompany();
  const item = async (name: string, price: string, cost: string) => {
    const product = await createProduct(titular, {
      sku: `P-${++skus}`,
      name,
    });
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
  const fridge = await item("Refrigerador", "10000", "6000");
  const bracket = await item("Soporte", "1000", "600");
  await setInstallmentTerms(titular, [{ months: "4", interest: "10" }]);
  const customer = await createCustomer(titular, { name: "Laura Núñez" });
  if (!customer.ok) throw new Error("customer setup failed");
  const cajera = await salesMember(titular.organizationId, "cashier");
  const quote = await createQuote(cajera, {
    customerId: customer.customer.id,
    lines: [
      { productId: fridge, capture: "base", quantity: "1" },
      { productId: bracket, capture: "base", quantity: "1" },
    ],
    plan: { months: "4", downPayment: "6600" },
  });
  if (!quote.ok) throw new Error("quote setup failed");
  await markQuoteSent(cajera, quote.quoteId);
  await acceptQuote(cajera, quote.quoteId);
  const order = await convertQuoteToOrder(cajera, quote.quoteId);
  if (!order.ok) throw new Error("order setup failed");
  const orderLines = await db.salesOrderLine.findMany({
    where: { orderId: order.orderId },
  });
  const sale = await fulfillSalesOrder(cajera, order.orderId, {
    lines: orderLines.map((line) => ({
      orderLineId: line.id,
      quantity: "1",
    })),
    payments: [{ method: "CASH", received: "6600" }],
    idempotencyKey: newId(),
  });
  if (!sale.ok) throw new Error("sale setup failed");
  const account = await db.salesReceivable.findFirstOrThrow({
    where: { saleId: sale.saleId },
  });
  const lines = await db.saleLine.findMany({ where: { saleId: sale.saleId } });
  const lineOf = (productId: string) =>
    lines.find((line) => line.productId === productId)!.id;
  const encargado = await salesMember(titular.organizationId, "cash_manager");
  return {
    titular,
    cajera,
    encargado,
    saleId: sale.saleId,
    receivableId: account.id,
    fridgeLine: lineOf(fridge),
    bracketLine: lineOf(bracket),
  };
}

const pay = (
  who: Awaited<ReturnType<typeof sold>>["cajera"],
  receivableId: string,
  amount: string,
) =>
  registerReceivablePayment(who, receivableId, {
    amount,
    method: "CASH",
    received: amount,
    idempotencyKey: newId(),
  });

describe("returns of a sale on installments", () => {
  it("come off the debt with their interest; only what passes it goes back", async () => {
    const s = await sold();
    await pay(s.cajera, s.receivableId, "1210");
    expect(await getReceivable(s.cajera, s.receivableId)).toMatchObject({
      balance: "$3,630.00",
    });

    // The bracket: $1,000 + $40 of interest come off; no money goes back.
    const bracket = await returnSale(s.encargado, s.saleId, {
      lines: [{ saleLineId: s.bracketLine, quantity: "1" }],
      reason: "No le sirvió",
      refundMethod: "",
      idempotencyKey: newId(),
    });
    expect(bracket).toMatchObject({
      ok: true,
      refund: "$0.00",
      credited: "$1,040.00",
    });
    let account = await getReceivable(s.cajera, s.receivableId);
    expect(account).toMatchObject({
      statusLabel: "Por cobrar",
      credited: "$1,040.00",
      balance: "$2,590.00",
    });
    // The monthly payment stays; the last one shrinks.
    expect(account!.installments.map((i) => i.left)).toEqual([
      "$0.00",
      "$1,210.00",
      "$1,210.00",
      "$170.00",
    ]);

    // The fridge passes the balance: the account is settled and the rest
    // goes back — all the customer paid, since all came back.
    const fridge = await returnSale(s.encargado, s.saleId, {
      lines: [{ saleLineId: s.fridgeLine, quantity: "1" }],
      reason: "No enfría",
      refundMethod: "CARD",
      reference: "DEV-1",
      idempotencyKey: newId(),
    });
    expect(fridge).toMatchObject({
      ok: true,
      refund: "$7,810.00",
      credited: "$2,590.00",
    });
    account = await getReceivable(s.cajera, s.receivableId);
    expect(account).toMatchObject({ statusLabel: "Pagada", balance: "$0.00" });
    expect(account!.installments.every((i) => i.left === "$0.00")).toBe(true);
    // Nothing more is paid on it.
    expect(await pay(s.cajera, s.receivableId, "1")).toMatchObject({
      ok: false,
    });

    // What came back is its goods: the history says the whole sale.
    const history = await listSales(s.cajera, {});
    expect(history.items[0]).toMatchObject({ refunded: "$11,000.00" });
    expect(await reconcileStock(s.titular.organizationId)).toEqual([]);
    expect(await reconcileValue(s.titular.organizationId)).toEqual([]);
  });

  it("with money to give back, ask how; cash comes out of the register", async () => {
    const s = await sold();
    const back = {
      lines: [{ saleLineId: s.fridgeLine, quantity: "1" }],
      reason: "No enfría",
      idempotencyKey: newId(),
    };
    // $10,000 + $400 against $4,840 owed: $5,560 go back.
    expect(
      await returnSale(s.encargado, s.saleId, { ...back, refundMethod: "" }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        refundMethod: expect.stringContaining("Se devuelven $5,560.00"),
      },
    });
    expect(
      await returnSale(s.encargado, s.saleId, {
        ...back,
        refundMethod: "CASH",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { refundMethod: expect.stringMatching(/no alcanza/) },
    });
    // With cash in the register it goes; the register gives it back.
    await recordCashMovement(s.encargado, {
      direction: "IN",
      amount: "6000",
      reason: "Fondo para devoluciones",
    });
    expect(
      await returnSale(s.encargado, s.saleId, {
        ...back,
        refundMethod: "CASH",
      }),
    ).toMatchObject({ ok: true, refund: "$5,560.00", credited: "$4,840.00" });
    expect((await getMyCashSession(s.encargado))?.totals).toMatchObject({
      expectedCash: "$440.00",
    });
  });
});

describe("cancelling a sale on installments", () => {
  it("gives back the down payment and the payments, and cancels the account", async () => {
    const s = await sold();
    await pay(s.cajera, s.receivableId, "1210");
    expect(await getReturnableSale(s.encargado, s.saleId)).toMatchObject({
      left: "$7,810.00",
      account: { balance: "$3,630.00" },
    });
    expect(
      await cancelSale(s.encargado, s.saleId, {
        reason: "Se arrepintió",
        refundMethod: "TRANSFER",
        reference: "SPEI-9",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: true, refund: "$7,810.00", credited: "$3,630.00" });
    expect(await getReceivable(s.cajera, s.receivableId)).toMatchObject({
      statusLabel: "Cancelada",
      balance: "$0.00",
    });
    expect(await reconcileStock(s.titular.organizationId)).toEqual([]);
  });

  it("of an account already paid: all of it goes back", async () => {
    const s = await sold();
    await pay(s.cajera, s.receivableId, "4840");
    expect(
      await cancelSale(s.encargado, s.saleId, {
        reason: "Se cobró mal",
        refundMethod: "CARD",
        reference: "DEV-2",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: true, refund: "$11,440.00", credited: "$0.00" });
    expect(await getReceivable(s.cajera, s.receivableId)).toMatchObject({
      statusLabel: "Cancelada",
    });
  });
});

describe("paying off early", () => {
  it("is a payment of the whole balance, interest included", async () => {
    const s = await sold();
    expect(await pay(s.cajera, s.receivableId, "4840.01")).toMatchObject({
      ok: false,
    });
    expect(await pay(s.cajera, s.receivableId, "4840")).toMatchObject({
      ok: true,
      balance: "$0.00",
      settled: true,
    });
  });
});

describe("the database", () => {
  it("keeps what came off an account as it was", async () => {
    const s = await sold();
    const done = await returnSale(s.encargado, s.saleId, {
      lines: [{ saleLineId: s.bracketLine, quantity: "1" }],
      reason: "No le sirvió",
      refundMethod: "",
      idempotencyKey: newId(),
    });
    if (!done.ok) throw new Error("return failed");
    const credit = await db.salesReceivableCredit.findFirstOrThrow({
      where: { returnId: done.returnId },
    });
    await expect(
      db.salesReceivableCredit.update({
        where: { id: credit.id },
        data: { credited: "1" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.salesReceivableCredit.delete({ where: { id: credit.id } }),
    ).rejects.toThrow(/immutable/);
  });
});
