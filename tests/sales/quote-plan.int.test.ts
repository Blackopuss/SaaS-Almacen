import { afterAll, afterEach, describe, expect, it } from "vitest";

import { registerEntry } from "@/modules/inventory";
import {
  buildQuotePdf,
  createQuote,
  getQuote,
  markQuoteSent,
  previewQuote,
  setInstallmentTerms,
  setSalePrices,
  updateQuote,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

const decoder = new TextDecoder("windows-1252");

/** The texts drawn on a PDF, as a person would read them. */
const textOf = (file: Buffer) =>
  [...file.toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
    .map((text) =>
      decoder.decode(Buffer.from(text[1]!.replace(/\\(.)/g, "$1"), "latin1")),
    )
    .join("\n");

// PAG-03 (ADR 0030): a quote offers cash or one of the company's terms,
// with a down payment that covers at least what the goods cost.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

/** A $10,000 fridge that cost $6,000; terms of 6 (10 %) and 12 months. */
async function setup() {
  const titular = await salesCompany();
  const product = await createProduct(titular, {
    sku: "REF-1",
    name: "Refrigerador",
  });
  if (!product.ok) throw new Error("product setup failed");
  await registerEntry(titular, {
    productId: product.productId,
    quantity: "3",
    unitCost: "6000",
  });
  await setSalePrices(titular, product.productId, {
    unitPrice: "10000",
    presentations: {},
  });
  await setInstallmentTerms(titular, [
    { months: "6", interest: "10" },
    { months: "12", interest: "" },
  ]);
  const customer = await createCustomer(titular, { name: "Laura Núñez" });
  if (!customer.ok) throw new Error("customer setup failed");
  const cajera = await salesMember(titular.organizationId, "cashier");
  return {
    titular,
    cajera,
    customerId: customer.customer.id,
    lines: [{ productId: product.productId, capture: "base", quantity: "1" }],
  };
}

describe("quote with a payment plan", () => {
  it("offers the term with its calendar; the interest is copied", async () => {
    const { titular, cajera, customerId, lines } = await setup();
    const quote = await createQuote(cajera, {
      customerId,
      lines,
      plan: { months: "6", downPayment: "6,000" },
    });
    if (!quote.ok) throw new Error(JSON.stringify(quote));
    // The titular changes the term afterwards: the quote keeps its 10 %.
    await setInstallmentTerms(titular, [{ months: "6", interest: "20" }]);
    expect((await getQuote(cajera, quote.quoteId))?.plan).toEqual({
      months: 6,
      interestText: "10 % de interés",
      downPayment: "$6,000.00",
      financed: "$4,000.00",
      interest: "$400.00",
      totalToPay: "$10,400.00",
      installment: "$733.33",
      lastInstallment: "$733.35",
    });
    // The PDF carries the plan.
    const pdf = await buildQuotePdf(cajera, quote.quoteId);
    if (!pdf) throw new Error("no pdf");
    const text = textOf(pdf.bytes);
    for (const expected of [
      "PLAN DE PAGOS: A 6 MESES",
      "$6,000.00",
      "6 mensualidades de",
      "$733.33",
      "$733.35",
      "$10,400.00",
    ]) {
      expect(text, expected).toContain(expected);
    }
    // Cash is still cash.
    const cash = await createQuote(cajera, { customerId, lines });
    if (!cash.ok) throw new Error("cash quote failed");
    expect((await getQuote(cajera, cash.quoteId))?.plan).toBeNull();
  });

  it("the down payment covers the cost; only who sees costs learns the minimum", async () => {
    const { titular, cajera, customerId, lines } = await setup();
    expect(
      await createQuote(cajera, {
        customerId,
        lines,
        plan: { months: "12", downPayment: "5999" },
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        planDownPayment:
          "El enganche no alcanza a cubrir el costo de la mercancía: súbelo.",
      },
    });
    expect(
      await createQuote(titular, {
        customerId,
        lines,
        plan: { months: "12", downPayment: "5999" },
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        planDownPayment:
          "El enganche debe cubrir el costo de la mercancía: al menos $6,000.00.",
      },
    });
    // The preview says the same, and never the cost to the cashier.
    const preview = await previewQuote(cajera, {
      lines,
      plan: { months: "12", downPayment: "100" },
    });
    expect(preview.plan).toBeNull();
    expect(JSON.stringify(preview)).not.toContain("6,000");
    expect(
      await createQuote(cajera, {
        customerId,
        lines,
        plan: { months: "12", downPayment: "10000" },
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        planDownPayment: "El enganche cubre todo: cóbrala de contado.",
      },
    });
    expect(
      await createQuote(cajera, {
        customerId,
        lines,
        plan: { months: "3", downPayment: "7000" },
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { planMonths: "Ese plazo ya no se ofrece. Elige otro." },
    });
    expect(
      (
        await previewQuote(cajera, {
          lines,
          plan: { months: "12", downPayment: "7000" },
        })
      ).plan,
    ).toMatchObject({ months: 12, installment: "$250.00", interest: "$0.00" });
  });

  it("the plan changes only while the quote is a draft", async () => {
    const { cajera, customerId, lines } = await setup();
    const quote = await createQuote(cajera, {
      customerId,
      lines,
      plan: { months: "6", downPayment: "6000" },
    });
    if (!quote.ok) throw new Error("quote failed");
    expect(
      await updateQuote(cajera, quote.quoteId, { customerId, lines }),
    ).toMatchObject({ ok: true });
    expect((await getQuote(cajera, quote.quoteId))?.plan).toBeNull();
    await markQuoteSent(cajera, quote.quoteId);
    await expect(
      db.salesQuote.update({
        where: { id: quote.quoteId },
        data: {
          installmentMonths: 6,
          installmentInterestPercent: "10",
          downPayment: "6000",
        },
      }),
    ).rejects.toThrow(/only a draft can be changed/);
    // The three go together.
    await expect(
      db.salesQuote.update({
        where: { id: quote.quoteId },
        data: { installmentMonths: 6 },
      }),
    ).rejects.toThrow(/sales_quote_plan_check|only a draft/);
  });
});
