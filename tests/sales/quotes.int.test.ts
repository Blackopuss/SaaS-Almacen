import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  createQuote,
  defaultQuoteValidity,
  getQuote,
  listQuotes,
  previewQuote,
  setSalePrices,
  updateQuote,
  updateSalesSettings,
  type QuoteInput,
} from "@/modules/sales";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-02 (ADR 0030): a quote to a customer with its validity, priced by
// presentation with VAT as the company has it; it needs no stock and no
// register, and a draft can be changed (and priced again).

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

type Actor = { organizationId: string; userId: string };

const day = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
  }).format(date);
};

let skus = 0;
async function shop(stock = "0") {
  const titular = await salesCompany();
  const created = await createProduct(titular, {
    sku: `C-${++skus}`,
    name: "Tornillo",
  });
  if (!created.ok) throw new Error("product setup failed");
  const productId = created.productId;
  const box = await createPresentation(titular, productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  if (stock !== "0") {
    await registerEntry(titular, {
      productId,
      quantity: stock,
      unitCost: "0.90",
    });
  }
  await setSalePrices(titular, productId, {
    unitPrice: "1.50",
    presentations: { [box.presentationId]: "500" },
  });
  const customer = await createCustomer(titular, { name: "Constructora Ruiz" });
  if (!customer.ok) throw new Error("customer setup failed");
  return {
    titular,
    productId,
    boxId: box.presentationId,
    customerId: customer.customer.id,
  };
}

const lines = (productId: string, boxId: string) => [
  { productId, capture: `p:${boxId}`, quantity: "1" },
  { productId, capture: "base", quantity: "3" },
];

describe("writing a quote", () => {
  it("with presentations and VAT, valid 15 days by default, without stock nor register", async () => {
    const { titular, productId, boxId, customerId } = await shop();
    const cajera = await salesMember(titular.organizationId, "cashier", {
      openCash: false,
    });
    const result = await createQuote(cajera, {
      customerId,
      lines: lines(productId, boxId),
      notes: "Entrega en obra",
    });
    expect(result).toEqual({
      ok: true,
      quoteId: expect.any(String),
      number: 1,
    });
    if (!result.ok) return;
    const quote = await getQuote(cajera, result.quoteId);
    expect(quote).toMatchObject({
      number: 1,
      status: "DRAFT",
      statusLabel: "Borrador",
      customer: { id: customerId, name: "Constructora Ruiz" },
      validUntil: await defaultQuoteValidity(cajera),
      notes: "Entrega en obra",
      subtotal: "$434.91",
      taxLabel: "IVA incluido (16 %)",
      tax: "$69.59",
      total: "$504.50",
      discount: null,
    });
    expect(
      quote!.lines.map((line) => [
        line.quantityText,
        line.unitPrice,
        line.amount,
      ]),
    ).toEqual([
      ["1 caja de 500 piezas", "$500.00 c/u", "$500.00"],
      ["3 piezas", "$1.50 c/u", "$4.50"],
    ]);
    // Nothing left stock.
    expect(
      await db.stockMovement.count({
        where: { organizationId: titular.organizationId },
      }),
    ).toBe(0);
  });

  it("with VAT added on top, the total adds it", async () => {
    const { titular, productId, boxId, customerId } = await shop();
    await updateSalesSettings(titular, { taxMode: "added", taxRate: "16" });
    const result = await createQuote(titular, {
      customerId,
      lines: lines(productId, boxId),
    });
    if (!result.ok) throw new Error("quote failed");
    expect(await getQuote(titular, result.quoteId)).toMatchObject({
      subtotal: "$504.50",
      tax: "$80.72",
      total: "$585.22",
      taxLabel: "IVA (16 %)",
    });
  });

  it("asks for a customer, a validity from today up to a year, and sellable lines", async () => {
    const { titular, productId, boxId } = await shop();
    const base: QuoteInput = { customerId: "", lines: lines(productId, boxId) };
    expect(await createQuote(titular, base)).toMatchObject({
      ok: false,
      fieldErrors: { customerId: "Elige a qué cliente va." },
    });
    const supplier = newId();
    await db.contact.create({
      data: {
        id: supplier,
        organizationId: titular.organizationId,
        name: "Solo proveedor",
        isSupplier: true,
        createdByUserId: titular.userId,
      },
    });
    expect(
      await createQuote(titular, { ...base, customerId: supplier }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { customerId: "Ese cliente ya no existe." },
    });
    const { customerId } = await shop();
    for (const [validUntil, message] of [
      [day(-2), /antes de hoy/],
      [day(400), /hasta un año/],
      ["2026-02-30", /día de calendario/],
    ] as const) {
      expect(
        await createQuote(titular, { ...base, customerId, validUntil }),
      ).toMatchObject({
        ok: false,
        fieldErrors: { validUntil: expect.stringMatching(message) },
      });
    }
    const unpriced = await createProduct(titular, {
      sku: "SP",
      name: "Sin precio",
    });
    if (!unpriced.ok) throw new Error("product setup failed");
    const own = await createCustomer(titular, { name: "Cliente propio" });
    if (!own.ok) throw new Error("customer setup failed");
    expect(
      await createQuote(titular, {
        customerId: own.customer.id,
        lines: [
          { productId: unpriced.productId, capture: "base", quantity: "1" },
        ],
      }),
    ).toMatchObject({
      ok: false,
      lineErrors: { 0: expect.stringMatching(/no tiene precio de venta/) },
    });
    expect(
      await createQuote(titular, { customerId: own.customer.id, lines: [] }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { lines: "Agrega al menos un producto." },
    });
  });

  it("a discount with its reason, within the cap of who quotes", async () => {
    const { titular, productId, boxId, customerId } = await shop("1000");
    const cajera = await salesMember(titular.organizationId, "cashier");
    const input = (percent: string, reason = "Mayoreo"): QuoteInput => ({
      customerId,
      lines: lines(productId, boxId),
      discount: { percent, reason },
    });
    expect(await createQuote(cajera, input("10"))).toMatchObject({
      ok: false,
      fieldErrors: { discountPercent: expect.stringMatching(/tope.*5 %/) },
    });
    expect(await createQuote(cajera, input("5", ""))).toMatchObject({
      ok: false,
      fieldErrors: { discountReason: expect.any(String) },
    });
    const done = await createQuote(cajera, input("5"));
    if (!done.ok) throw new Error("quote failed");
    expect(await getQuote(cajera, done.quoteId)).toMatchObject({
      discount: { text: "-$25.23 (5 %)", reason: "Mayoreo" },
      total: "$479.27",
    });
    expect(
      await previewQuote(cajera, {
        lines: lines(productId, boxId),
        discountPercent: "10",
      }),
    ).toMatchObject({ discountError: "Tu tope de descuento es 5 %." });
  });

  it("numbers one after another, also when two are written at once", async () => {
    const { titular, productId, boxId, customerId } = await shop();
    const input = { customerId, lines: lines(productId, boxId) };
    const answers = await Promise.all([
      createQuote(titular, input),
      createQuote(titular, input),
      createQuote(titular, input),
    ]);
    expect(
      answers.map((answer) => (answer.ok ? answer.number : 0)).sort(),
    ).toEqual([1, 2, 3]);
  });
});

describe("changing a draft", () => {
  it("prices it again; once sent it no longer changes", async () => {
    const { titular, productId, boxId, customerId } = await shop();
    const created = await createQuote(titular, {
      customerId,
      lines: lines(productId, boxId),
    });
    if (!created.ok) throw new Error("quote failed");
    await setSalePrices(titular, productId, {
      unitPrice: "2",
      presentations: { [boxId]: "600" },
    });
    const validUntil = day(30);
    expect(
      await updateQuote(titular, created.quoteId, {
        customerId,
        validUntil,
        lines: [{ productId, capture: `p:${boxId}`, quantity: "2" }],
      }),
    ).toEqual({ ok: true, quoteId: created.quoteId, number: 1 });
    expect(await getQuote(titular, created.quoteId)).toMatchObject({
      validUntil,
      total: "$1,200.00",
      lines: [{ quantityText: "2 cajas de 500 piezas" }],
    });

    await db.salesQuote.update({
      where: { id: created.quoteId },
      data: { status: "SENT", sentAt: new Date() },
    });
    expect(
      await updateQuote(titular, created.quoteId, {
        customerId,
        lines: lines(productId, boxId),
      }),
    ).toMatchObject({ ok: false, reason: "not_draft" });
  });

  it("a sent quote past its day reads as expired", async () => {
    const { titular, productId, boxId, customerId } = await shop();
    const created = await createQuote(titular, {
      customerId,
      lines: lines(productId, boxId),
    });
    if (!created.ok) throw new Error("quote failed");
    await db.salesQuote.update({
      where: { id: created.quoteId },
      data: { validUntil: new Date(`${day(-3)}T00:00:00.000Z`) },
    });
    await db.salesQuote.update({
      where: { id: created.quoteId },
      data: { status: "SENT", sentAt: new Date() },
    });
    expect(await getQuote(titular, created.quoteId)).toMatchObject({
      status: "EXPIRED",
      statusLabel: "Vencida",
    });
    expect((await listQuotes(titular)).items).toMatchObject([
      {
        number: 1,
        statusLabel: "Vencida",
        customer: "Constructora Ruiz",
        total: "$504.50",
      },
    ]);
  });
});

describe("who may", () => {
  it("Consulta reads quotes but does not write them; Almacén neither", async () => {
    const { titular, productId, boxId, customerId } = await shop();
    const created = await createQuote(titular, {
      customerId,
      lines: lines(productId, boxId),
    });
    if (!created.ok) throw new Error("quote failed");
    const consulta = await salesMember(titular.organizationId, "viewer");
    expect((await getQuote(consulta, created.quoteId))?.number).toBe(1);
    await expect(
      createQuote(consulta, { customerId, lines: lines(productId, boxId) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const almacen = await salesMember(titular.organizationId, "warehouse");
    await expect(getQuote(almacen, created.quoteId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("another company's quote does not exist", async () => {
    const { titular, productId, boxId, customerId } = await shop();
    const created = await createQuote(titular, {
      customerId,
      lines: lines(productId, boxId),
    });
    if (!created.ok) throw new Error("quote failed");
    const other = await salesCompany();
    expect(await getQuote(other, created.quoteId)).toBeNull();
    expect((await listQuotes(other)).total).toBe(0);
    const theirs = await createCustomer(other, { name: "Ajeno" });
    if (!theirs.ok) throw new Error("customer setup failed");
    expect(
      await updateQuote(other, created.quoteId, {
        customerId: theirs.customer.id,
        lines: lines(productId, boxId),
      }),
    ).toMatchObject({ ok: false });
    // Nor can it use this company's customer or products.
    expect(
      await createQuote(other, { customerId, lines: lines(productId, boxId) }),
    ).toMatchObject({ ok: false });
  });
});
