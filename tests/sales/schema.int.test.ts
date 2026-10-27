import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { reverseMovement } from "@/modules/inventory";
import { createPresentation, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany } from "../setup/sales";

// VEN-05 (ADR 0030): the database keeps a sale whole by itself — amounts
// that add up, a stock exit of its own kind, and history that never
// changes except for its cancellation.

let actor: { organizationId: string; userId: string };
let productId: string;
let boxId: string;
let boxVersionId: string;
let locationId: string;

beforeAll(async () => {
  actor = await salesCompany();
  const created = await createProduct(actor, { sku: "S-1", name: "Tornillo" });
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
  locationId = (
    await db.location.findFirstOrThrow({
      where: { organizationId: actor.organizationId, isDefault: true },
    })
  ).id;
});
afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

let numbers = 0;
async function movement(type: "SALE" | "EXIT" = "SALE") {
  const id = newId();
  await db.stockMovement.create({
    data: {
      id,
      organizationId: actor.organizationId,
      type,
      createdByUserId: actor.userId,
    },
  });
  return id;
}

async function sale(overrides: Record<string, unknown> = {}) {
  const id = newId();
  await db.sale.create({
    data: {
      id,
      organizationId: actor.organizationId,
      number: ++numbers,
      movementId: await movement(),
      pricesIncludeTax: true,
      taxRate: "16",
      subtotal: "431.03",
      tax: "68.97",
      total: "500",
      idempotencyKey: newId(),
      soldByUserId: actor.userId,
      ...overrides,
    },
  });
  return id;
}

const line = (saleId: string, overrides: Record<string, unknown> = {}) =>
  db.saleLine.create({
    data: {
      id: newId(),
      organizationId: actor.organizationId,
      saleId,
      lineNumber: 1,
      productId,
      locationId,
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

const payment = (saleId: string, overrides: Record<string, unknown> = {}) =>
  db.salePayment.create({
    data: {
      id: newId(),
      organizationId: actor.organizationId,
      saleId,
      lineNumber: 1,
      method: "CASH",
      amount: "500",
      received: "1000",
      changeGiven: "500",
      ...overrides,
    },
  });

describe("sale schema", () => {
  it("keeps a whole sale: a box at $500 paid in cash with change", async () => {
    const saleId = await sale();
    await line(saleId);
    await payment(saleId);
    const stored = await db.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: { lines: true, payments: true },
    });
    expect(stored.status).toBe("COMPLETED");
    expect(stored.lines[0]?.baseQuantity.toString()).toBe("500");
    expect(stored.payments[0]?.changeGiven?.toString()).toBe("500");
  });

  it("amounts add up: subtotal + VAT = total", async () => {
    await expect(sale({ tax: "68.96" })).rejects.toThrow(/sale_amounts_check/);
    await expect(sale({ taxRate: "101" })).rejects.toThrow(
      /sale_amounts_check/,
    );
  });

  it("a line is quantity × price in cents, minus its discount", async () => {
    const saleId = await sale();
    // 2.755 × $10.01 = 27.57755 → $27.58; minus $1.58 of discount.
    await line(saleId, {
      presentationId: null,
      presentationVersionId: null,
      capturedQuantity: "2.755",
      factor: "1",
      baseQuantity: "2.755",
      unitPrice: "10.01",
      discount: "1.58",
      amount: "26.00",
    });
    await expect(
      line(saleId, { lineNumber: 2, amount: "499.99" }),
    ).rejects.toThrow(/sale_line_amount_check/);
    await expect(
      line(saleId, { lineNumber: 2, discount: "600", amount: "-100" }),
    ).rejects.toThrow(/sale_line_amount_check/);
    await expect(
      line(saleId, { lineNumber: 2, baseQuantity: "499" }),
    ).rejects.toThrow(/sale_line_quantities_check/);
  });

  it("cash keeps what was handed over and the change; cards, only a reference", async () => {
    const saleId = await sale();
    await expect(payment(saleId, { changeGiven: "400" })).rejects.toThrow(
      /sale_payment_amounts_check/,
    );
    await expect(
      payment(saleId, { received: "400", changeGiven: "-100" }),
    ).rejects.toThrow(/sale_payment_amounts_check/);
    await expect(
      payment(saleId, { method: "CARD", reference: "123456" }),
    ).rejects.toThrow(/sale_payment_amounts_check/);
    await payment(saleId, {
      method: "CARD",
      received: null,
      changeGiven: null,
      reference: "123456",
    });
  });

  it("its movement must be a sale, and its customer a customer", async () => {
    await expect(sale({ movementId: await movement("EXIT") })).rejects.toThrow(
      /not a sale/,
    );
    const supplier = await db.contact.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: "Proveedor",
        isSupplier: true,
        createdByUserId: actor.userId,
      },
    });
    await expect(sale({ customerId: supplier.id })).rejects.toThrow(
      /not a customer/,
    );
    const customer = await db.contact.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: "Constructora",
        isCustomer: true,
        createdByUserId: actor.userId,
      },
    });
    await sale({ customerId: customer.id });
  });

  it("never changes nor disappears, except for a cancellation, once", async () => {
    const saleId = await sale();
    await line(saleId);
    await payment(saleId);
    await expect(
      db.sale.update({ where: { id: saleId }, data: { total: "1" } }),
    ).rejects.toThrow();
    await expect(db.sale.delete({ where: { id: saleId } })).rejects.toThrow(
      /immutable/,
    );
    await expect(
      db.saleLine.updateMany({ where: { saleId }, data: { discount: "1" } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.salePayment.deleteMany({ where: { saleId } }),
    ).rejects.toThrow(/immutable/);
    // Cancelling needs who, when and why.
    await expect(
      db.sale.update({
        where: { id: saleId },
        data: { status: "CANCELLED" },
      }),
    ).rejects.toThrow(/sale_cancel_check/);
    const cancel = {
      status: "CANCELLED" as const,
      cancelledByUserId: actor.userId,
      cancelledAt: new Date(),
      cancelReason: "Se equivocó de producto",
    };
    await db.sale.update({ where: { id: saleId }, data: cancel });
    await expect(
      db.sale.update({
        where: { id: saleId },
        data: { ...cancel, cancelReason: "Otra vez" },
      }),
    ).rejects.toThrow(/only a completed sale/);
  });

  it("a sale's stock exit is not reversed from Inventario", async () => {
    const movementId = await movement();
    expect(
      await reverseMovement(actor, {
        movementId,
        reason: "Error",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      reason: "not_allowed",
      error: expect.stringMatching(/es una venta/),
    });
  });
});
