import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import { jobHandlers } from "@/modules/registry/jobs";
import {
  acceptQuote,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getAccountReminders,
  getReceivable,
  listReceivables,
  markQuoteSent,
  readOverdueReminders,
  registerReceivablePayment,
  scheduleOverdueReminders,
  setInstallmentTerms,
  setOverdueReminders,
  setSalePrices,
  setSalesClock,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer, setCustomerEmail } from "@/platform/contacts";
import { memoryOutboxFor } from "@/platform/email";
import { invalidateEntitlements } from "@/platform/entitlements";
import { runNextJob } from "@/platform/jobs";
import { db, forOrganization } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// PAG-07 (ADR 0030): overdue accounts are listed, and — when the titular
// turns it on — the worker mails one reminder per installment that falls
// due unpaid, in the daytime, never once it was paid.

const DAY_MS = 24 * 60 * 60 * 1000;
let restore: (() => void) | null = null;
/** So many days from now, at 12:00 in Mexico City (18:00 UTC). */
function travel(days: number, utcHour = 18) {
  restore?.();
  const moment = new Date(Date.now() + days * DAY_MS);
  moment.setUTCHours(utcHour, 0, 0, 0);
  restore = setSalesClock(() => moment.getTime());
}

afterEach(() => {
  restore?.();
  restore = null;
  invalidateEntitlements();
});
afterAll(() => db.$disconnect());

async function drain() {
  for (let i = 0; i < 10; i++) {
    const outcome = await runNextJob(jobHandlers, { workerId: "test" });
    if (outcome.kind === "idle") break;
  }
}

let mails = 0;
const stamp = Date.now();

/** $10,000 fridge, $6,000 down, 4 × $1,000 a month; $1,500 paid. */
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
  await registerReceivablePayment(cajera, receivable.id, {
    amount: "1500",
    method: "CASH",
    idempotencyKey: newId(),
  });
  return {
    titular,
    cajera,
    organizationId: titular.organizationId,
    customerId: customer.customer.id,
    receivableId: receivable.id,
  };
}

describe("overdue accounts", () => {
  it("are listed with what is overdue and since when", async () => {
    const { cajera, receivableId } = await account();
    expect((await listReceivables(cajera, { overdue: true })).items).toEqual(
      [],
    );
    // 75 days later the first two installments passed: $500 of the second.
    travel(75);
    const list = await listReceivables(cajera, { overdue: true });
    expect(list.items).toMatchObject([
      { id: receivableId, overdue: true, overdueAmount: "$500.00" },
    ]);
    expect(list.items[0]!.overdueSinceText).toBeTruthy();
    expect(await getReceivable(cajera, receivableId)).toMatchObject({
      overdue: "$500.00",
      balance: "$2,500.00",
    });
  });
});

describe("reminders of overdue payments", () => {
  it("are off until the titular turns them on, and only the titular", async () => {
    const { titular, cajera, organizationId } = await account();
    const client = forOrganization(organizationId);
    expect(await readOverdueReminders(client)).toBe(false);
    await expect(setOverdueReminders(cajera, true)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    travel(75);
    expect(await scheduleOverdueReminders(organizationId)).toEqual({
      queued: 0,
    });
    expect(await setOverdueReminders(titular, true)).toEqual({
      ok: true,
      changed: true,
    });
    expect(await setOverdueReminders(titular, true)).toEqual({
      ok: true,
      changed: false,
    });
    expect(await readOverdueReminders(client)).toBe(true);
  });

  it("go once per installment that falls due, in the daytime, from the worker", async () => {
    const { titular, cajera, organizationId, customerId, receivableId } =
      await account();
    await setOverdueReminders(titular, true);
    travel(75);
    // No address on the card: nothing to send yet.
    expect(await scheduleOverdueReminders(organizationId)).toEqual({
      queued: 0,
    });
    const to = `cliente.${++mails}.${stamp}@obra.example`;
    await setCustomerEmail(titular, customerId, to);
    // At night nothing goes.
    travel(75, 5);
    expect(await scheduleOverdueReminders(organizationId)).toEqual({
      queued: 0,
    });
    travel(75);
    expect(await scheduleOverdueReminders(organizationId)).toEqual({
      queued: 1,
    });
    expect(await scheduleOverdueReminders(organizationId)).toEqual({
      queued: 0,
    });
    await drain();
    const sent = memoryOutboxFor(to);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("Tienes un pago vencido");
    expect(sent[0]!.text).toContain("$500.00");
    expect(sent[0]!.text).toContain("$2,500.00");
    expect(sent[0]!.replyTo).toBe(
      (
        await db.user.findFirstOrThrow({
          where: { id: titular.userId },
          select: { email: true },
        })
      ).email,
    );
    expect(await getAccountReminders(cajera, receivableId)).toMatchObject([
      { installmentNumber: 2, status: "SENT", recipient: to },
    ]);

    // The third falls due: one more. Paid before the worker gets to it:
    // it does not go.
    travel(100);
    expect(await scheduleOverdueReminders(organizationId)).toEqual({
      queued: 1,
    });
    await registerReceivablePayment(cajera, receivableId, {
      amount: "2500",
      method: "CARD",
      reference: "AUT-1",
      idempotencyKey: newId(),
    });
    await drain();
    expect(memoryOutboxFor(to)).toHaveLength(1);
    expect(await getAccountReminders(cajera, receivableId)).toMatchObject([
      {
        installmentNumber: 3,
        status: "FAILED",
        failureReason: "Ya no tenía pagos vencidos cuando tocaba enviarlo.",
      },
      { installmentNumber: 2, status: "SENT" },
    ]);
  });

  it("stop when they are turned off before going", async () => {
    const { titular, organizationId, customerId, cajera, receivableId } =
      await account();
    await setCustomerEmail(
      titular,
      customerId,
      `cliente.${++mails}.${stamp}@obra.example`,
    );
    await setOverdueReminders(titular, true);
    travel(75);
    await scheduleOverdueReminders(organizationId);
    await setOverdueReminders(titular, false);
    await drain();
    expect(await getAccountReminders(cajera, receivableId)).toMatchObject([
      {
        status: "FAILED",
        failureReason: "Los recordatorios se apagaron antes de enviarlo.",
      },
    ]);
    // Another company never sees them.
    const other = await salesCompany();
    expect(await getAccountReminders(other, receivableId)).toEqual([]);
  });
});
