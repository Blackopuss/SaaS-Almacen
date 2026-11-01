import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-01 (ADR 0030): the database keeps a quote whole by itself — it goes
// to a customer, needs no cash register, and once it leaves the draft
// nothing it offered changes.

let actor: { organizationId: string; userId: string };
let productId: string;
let boxId: string;
let boxVersionId: string;
let customerId: string;
let supplierId: string;
let cashier: { organizationId: string; userId: string };

beforeAll(async () => {
  actor = await salesCompany();
  // Who writes these quotes has no register open: a quote needs none.
  cashier = await salesMember(actor.organizationId, "cashier", {
    openCash: false,
  });
  const created = await createProduct(actor, { sku: "Q-1", name: "Tornillo" });
  if (!created.ok) throw new Error("product setup failed");
  productId = created.productId;
  const box = await createPresentation(actor, productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  boxId = box.presentationId;
  boxVersionId = (
    await db.presentationVersion.findFirstOrThrow({
      where: { presentationId: boxId },
    })
  ).id;
  const customer = await createCustomer(actor, { name: "Constructora" });
  if (!customer.ok) throw new Error("customer setup failed");
  customerId = customer.customer.id;
  supplierId = newId();
  await db.contact.create({
    data: {
      id: supplierId,
      organizationId: actor.organizationId,
      name: "Solo proveedor",
      isSupplier: true,
      createdByUserId: actor.userId,
    },
  });
});
afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

let numbers = 0;
async function quote(overrides: Record<string, unknown> = {}) {
  const id = newId();
  await db.salesQuote.create({
    data: {
      id,
      organizationId: actor.organizationId,
      number: ++numbers,
      customerId,
      validUntil: new Date("2026-11-30"),
      pricesIncludeTax: true,
      taxRate: "16",
      createdByUserId: cashier.userId,
      ...overrides,
    },
  });
  return id;
}

function line(quoteId: string, overrides: Record<string, unknown> = {}) {
  return db.salesQuoteLine.create({
    data: {
      id: newId(),
      organizationId: actor.organizationId,
      quoteId,
      lineNumber: 1,
      productId,
      capturedQuantity: "1",
      presentationId: boxId,
      presentationVersionId: boxVersionId,
      factor: "500",
      baseQuantity: "500",
      unitCode: "piece",
      unitPrice: "500",
      amount: "500",
      ...overrides,
    },
  });
}

const send = (id: string) =>
  db.salesQuote.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date() },
  });

describe("sales quote schema", () => {
  it("a draft to a customer, with lines, without any cash register", async () => {
    const id = await quote();
    await line(id);
    await line(id, {
      lineNumber: 2,
      presentationId: null,
      presentationVersionId: null,
      capturedQuantity: "3",
      factor: "1",
      baseQuantity: "3",
      unitPrice: "1.50",
      discount: "0.50",
      amount: "4",
    });
    const saved = await db.salesQuote.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });
    expect(saved.status).toBe("DRAFT");
    expect(saved.lines).toHaveLength(2);
    expect(
      await db.cashSession.count({
        where: { openedByUserId: cashier.userId },
      }),
    ).toBe(0);
  });

  it("goes to a customer and is born a draft", async () => {
    await expect(quote({ customerId: supplierId })).rejects.toThrow(
      /not a customer/,
    );
    await expect(quote({ status: "SENT", sentAt: new Date() })).rejects.toThrow(
      /created as a draft/,
    );
    const id = await quote();
    await expect(
      db.salesQuote.update({ where: { id }, data: { customerId: supplierId } }),
    ).rejects.toThrow(/not a customer/);
  });

  it("amounts and quantities add up; a discount has its reason", async () => {
    const id = await quote();
    await expect(line(id, { amount: "499" })).rejects.toThrow();
    await expect(line(id, { baseQuantity: "400" })).rejects.toThrow();
    await expect(
      line(id, { capturedQuantity: "0", baseQuantity: "0", amount: "0" }),
    ).rejects.toThrow();
    await expect(line(id, { presentationVersionId: null })).rejects.toThrow();
    await expect(line(id, { unitCode: "meter" })).rejects.toThrow(
      /unit of the product/,
    );
    await expect(quote({ discountPercent: "5" })).rejects.toThrow();
    await expect(quote({ taxRate: "101" })).rejects.toThrow();
    expect(
      await quote({ discountPercent: "5", discountReason: "Mayoreo" }),
    ).toEqual(expect.any(String));
  });

  it("once sent, neither the lines nor what it offers change", async () => {
    const id = await quote();
    const first = await line(id);
    await send(id);
    await expect(line(id, { lineNumber: 2 })).rejects.toThrow(/not a draft/);
    await expect(
      db.salesQuoteLine.update({
        where: { id: first.id },
        data: { unitPrice: "1", amount: "1" },
      }),
    ).rejects.toThrow(/not a draft/);
    await expect(
      db.salesQuoteLine.delete({ where: { id: first.id } }),
    ).rejects.toThrow(/not a draft/);
    await expect(
      db.salesQuote.update({
        where: { id },
        data: { validUntil: new Date("2027-01-31") },
      }),
    ).rejects.toThrow(/only a draft/);
    await expect(
      db.salesQuote.update({ where: { id }, data: { number: 999 } }),
    ).rejects.toThrow(/cannot change/);
  });

  it("each state carries its own data, and a quote is never deleted", async () => {
    const id = await quote();
    await expect(
      db.salesQuote.update({ where: { id }, data: { status: "SENT" } }),
    ).rejects.toThrow();
    await send(id);
    await expect(
      db.salesQuote.update({ where: { id }, data: { status: "ACCEPTED" } }),
    ).rejects.toThrow();
    await db.salesQuote.update({
      where: { id },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
        decidedByUserId: actor.userId,
        rejectReason: "Muy caro",
      },
    });
    await expect(db.salesQuote.delete({ where: { id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      db.salesQuote.update({ where: { id }, data: { number: 1000 } }),
    ).rejects.toThrow(/cannot change/);
  });
});
