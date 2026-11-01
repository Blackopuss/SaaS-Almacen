import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import { jobHandlers } from "@/modules/registry/jobs";
import {
  acceptQuote,
  buildStatementPdf,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getCustomerStatement,
  getStatementDeliveries,
  markQuoteSent,
  registerReceivablePayment,
  requestStatementDelivery,
  setInstallmentTerms,
  setSalePrices,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer, setCustomerEmail } from "@/platform/contacts";
import { memoryOutboxFor } from "@/platform/email";
import { invalidateEntitlements } from "@/platform/entitlements";
import { runNextJob } from "@/platform/jobs";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// PAG-06 (ADR 0030): a customer's statement — balance, payments made and
// the next ones — on screen, as PDF and by mail from the worker.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

const decoder = new TextDecoder("windows-1252");
const textOf = (file: Buffer) =>
  [...file.toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
    .map((text) =>
      decoder.decode(Buffer.from(text[1]!.replace(/\\(.)/g, "$1"), "latin1")),
    )
    .join("\n");

let mails = 0;
const stamp = Date.now();

/** A customer with one account: $10,000 fridge, $6,000 down, 4 × $1,000. */
async function customerWithAccount() {
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
  const account = await db.salesReceivable.findFirstOrThrow({
    where: { saleId: sale.saleId },
  });
  await registerReceivablePayment(cajera, account.id, {
    amount: "1500",
    method: "CASH",
    idempotencyKey: newId(),
  });
  return { titular, cajera, customerId: customer.customer.id };
}

describe("statement of account", () => {
  it("says the balance, the payments made and the next ones", async () => {
    const { cajera, customerId } = await customerWithAccount();
    const statement = await getCustomerStatement(cajera, customerId);
    expect(statement).toMatchObject({
      customer: { name: "Laura Núñez" },
      balance: "$2,500.00",
      overdue: "$0.00",
    });
    expect(statement!.accounts).toHaveLength(1);
    expect(statement!.upcoming.map((next) => [next.number, next.left])).toEqual(
      [
        [2, "$500.00"],
        [3, "$1,000.00"],
        [4, "$1,000.00"],
      ],
    );
    expect(statement!.payments).toMatchObject([{ amount: "$1,500.00" }]);

    const pdf = await buildStatementPdf(cajera, customerId);
    if (!pdf) throw new Error("no pdf");
    const text = textOf(pdf.bytes);
    for (const expected of [
      "ESTADO DE CUENTA",
      "Laura Núñez",
      "$2,500.00",
      "PRÓXIMOS PAGOS",
      "PAGOS RECIBIDOS",
      "$1,500.00",
      "No es un comprobante fiscal.",
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it("is mailed from the worker to the address of the customer's card", async () => {
    const { titular, cajera, customerId } = await customerWithAccount();
    expect(await requestStatementDelivery(cajera, customerId)).toMatchObject({
      ok: false,
      reason: "no_recipient",
    });
    const to = `cliente.${++mails}.${stamp}@obra.example`;
    await setCustomerEmail(titular, customerId, to);
    expect(await requestStatementDelivery(cajera, customerId)).toEqual({
      ok: true,
      recipient: to,
    });
    expect(await requestStatementDelivery(cajera, customerId)).toMatchObject({
      ok: true,
      repeated: true,
    });
    for (let i = 0; i < 10; i++) {
      const outcome = await runNextJob(jobHandlers, { workerId: "test" });
      if (outcome.kind === "idle") break;
    }
    const [mail] = memoryOutboxFor(to);
    expect(mail?.text).toContain("Tu saldo es de $2,500.00.");
    expect(mail?.attachments?.[0]?.name).toBe("estado-de-cuenta.pdf");
    expect(
      (await getStatementDeliveries(cajera, customerId)).map((d) => d.status),
    ).toEqual(["SENT"]);
  });

  it("only who reads accounts; nobody of another company", async () => {
    const { titular, customerId } = await customerWithAccount();
    const almacen = await salesMember(titular.organizationId, "warehouse");
    await expect(
      getCustomerStatement(almacen, customerId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const consulta = await salesMember(titular.organizationId, "viewer");
    expect((await getCustomerStatement(consulta, customerId))?.balance).toBe(
      "$2,500.00",
    );
    await expect(
      requestStatementDelivery(consulta, customerId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await getCustomerStatement(await salesCompany(), customerId),
    ).toBeNull();
  });
});
