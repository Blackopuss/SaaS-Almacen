import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import {
  reconcileStock,
  reconcileValue,
  registerEntry,
} from "@/modules/inventory";
import {
  SALE_KEY_REUSED,
  findSaleByKey,
  registerSale,
  setSalePrices,
  updateSalesSettings,
  type SaleInput,
} from "@/modules/sales";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-09..13 (ADR 0030): a sale and its stock exit are one transaction;
// prices, VAT and change come from the server; a double click sells once
// and the last unit goes to one customer.

type Actor = { organizationId: string; userId: string };

let skus = 0;
async function screws(actor: Actor, stock = "1000") {
  const created = await createProduct(actor, {
    sku: `T-${++skus}`,
    name: `Tornillo ${skus}`,
  });
  if (!created.ok) throw new Error("product setup failed");
  const box = await createPresentation(actor, created.productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  await registerEntry(actor, {
    productId: created.productId,
    quantity: stock,
    unitCost: "0.90",
  });
  await setSalePrices(actor, created.productId, {
    unitPrice: "1.50",
    presentations: { [box.presentationId]: "500" },
  });
  return { productId: created.productId, boxId: box.presentationId };
}

const stockOf = async (productId: string) =>
  (
    await db.stockBalance.aggregate({
      where: { productId },
      _sum: { quantity: true },
    })
  )._sum.quantity?.toString();

const cash = (received = "") => [{ method: "CASH", received }];

async function settled(organizationId: string) {
  expect(await reconcileStock(organizationId)).toEqual([]);
  expect(await reconcileValue(organizationId)).toEqual([]);
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("registering a sale", () => {
  it("a box and loose pieces, in cash with change: stock and value leave with it", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const result = await registerSale(actor, {
      lines: [
        { productId, capture: `p:${boxId}`, quantity: "1" },
        { productId, capture: "base", quantity: "3" },
      ],
      payments: cash("600"),
      idempotencyKey: newId(),
    });
    expect(result).toEqual({
      ok: true,
      saleId: expect.any(String),
      number: 1,
      total: "$504.50",
      change: "$95.50",
    });
    if (!result.ok) return;
    expect(await stockOf(productId)).toBe("497");

    const sale = await db.sale.findUniqueOrThrow({
      where: { id: result.saleId },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        payments: true,
        movement: { include: { lines: true } },
      },
    });
    expect(sale).toMatchObject({
      status: "COMPLETED",
      customerId: null,
      pricesIncludeTax: true,
      subtotal: expect.objectContaining({}),
    });
    expect(sale.subtotal.toString()).toBe("434.91");
    expect(sale.tax.toString()).toBe("69.59");
    expect(
      sale.lines.map((line) => [
        line.capturedQuantity.toString(),
        line.baseQuantity.toString(),
        line.unitPrice.toString(),
        line.amount.toString(),
        line.unitCost?.toString(),
      ]),
    ).toEqual([
      ["1", "500", "500", "500", "0.9"],
      ["3", "3", "1.5", "4.5", "0.9"],
    ]);
    expect(
      sale.payments.map((p) => [
        p.method,
        p.amount.toString(),
        p.received?.toString(),
        p.changeGiven?.toString(),
      ]),
    ).toEqual([["CASH", "504.5", "600", "95.5"]]);
    expect(sale.movement.type).toBe("SALE");
    expect(sale.movement.reference).toBe("Venta 1");
    await settled(actor.organizationId);
  });

  it("numbers sales one after another", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor);
    const numbers = [];
    for (let i = 0; i < 3; i++) {
      const result = await registerSale(actor, {
        lines: [{ productId, capture: "base", quantity: "1" }],
        payments: cash(),
        idempotencyKey: newId(),
      });
      numbers.push(result.ok ? result.number : null);
    }
    expect(numbers).toEqual([1, 2, 3]);
  });

  it("sells to a customer, never to a contact that is only a supplier", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor);
    const customer = await createCustomer(actor, { name: "Constructora" });
    if (!customer.ok) throw new Error("setup failed");
    const sale = (customerId: string): SaleInput => ({
      lines: [{ productId, capture: "base", quantity: "1" }],
      customerId,
      payments: cash(),
      idempotencyKey: newId(),
    });
    const sold = await registerSale(actor, sale(customer.customer.id));
    expect(sold.ok).toBe(true);
    if (sold.ok) {
      expect(
        (await db.sale.findUniqueOrThrow({ where: { id: sold.saleId } }))
          .customerId,
      ).toBe(customer.customer.id);
    }
    const supplier = await db.contact.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: "Proveedor",
        isSupplier: true,
        createdByUserId: actor.userId,
      },
    });
    expect(await registerSale(actor, sale(supplier.id))).toMatchObject({
      ok: false,
      customerError: expect.stringMatching(/ya no existe/),
    });
  });

  it("without enough stock nothing is sold and nothing leaves", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor, "600");
    const result = await registerSale(actor, {
      lines: [
        { productId, capture: `p:${boxId}`, quantity: "1" },
        { productId, capture: "base", quantity: "101" },
      ],
      payments: cash(),
      idempotencyKey: newId(),
    });
    expect(result).toMatchObject({
      ok: false,
      lineErrors: { 1: expect.stringMatching(/Solo hay 600 piezas/) },
    });
    expect(await stockOf(productId)).toBe("600");
    expect(
      await db.sale.count({ where: { organizationId: actor.organizationId } }),
    ).toBe(0);
    await settled(actor.organizationId);
  });

  it("cash must cover the total (VEN-11)", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor);
    expect(
      await registerSale(actor, {
        lines: [{ productId, capture: "base", quantity: "10" }],
        payments: cash("10"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      paymentErrors: { 0: "El efectivo recibido no alcanza: faltan $5.00." },
    });
  });

  it("card and transfer keep their reference; nothing is charged here (VEN-12)", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor);
    const lines = [{ productId, capture: "base", quantity: "2" }];
    expect(
      await registerSale(actor, {
        lines,
        payments: [{ method: "CARD" }],
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      paymentErrors: { 0: expect.stringMatching(/autorización/) },
    });
    const card = await registerSale(actor, {
      lines,
      payments: [{ method: "CARD", reference: "123456" }],
      idempotencyKey: newId(),
    });
    expect(card).toMatchObject({ ok: true, total: "$3.00", change: null });
    const transfer = await registerSale(actor, {
      lines,
      payments: [{ method: "TRANSFER", reference: "MBAN0123" }],
      idempotencyKey: newId(),
    });
    expect(transfer.ok).toBe(true);
    const stored = await db.salePayment.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { id: "asc" },
    });
    expect(stored.map((p) => [p.method, p.reference, p.received])).toEqual([
      ["CARD", "123456", null],
      ["TRANSFER", "MBAN0123", null],
    ]);
  });

  it("mixed payments must add up to the total (VEN-13)", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const lines = [{ productId, capture: `p:${boxId}`, quantity: "1" }];
    expect(
      await registerSale(actor, {
        lines,
        payments: [
          { method: "CASH", amount: "200", received: "200" },
          { method: "CARD", amount: "250", reference: "A1" },
        ],
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/faltan \$50\.00/),
    });
    expect(
      await registerSale(actor, {
        lines,
        payments: [
          { method: "CASH", amount: "100" },
          { method: "CASH", amount: "400" },
        ],
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/un solo pago/),
    });
    const mixed = await registerSale(actor, {
      lines,
      payments: [
        { method: "CASH", amount: "200", received: "500" },
        { method: "CARD", amount: "300", reference: "A1" },
      ],
      idempotencyKey: newId(),
    });
    expect(mixed).toMatchObject({
      ok: true,
      total: "$500.00",
      change: "$300.00",
    });
  });

  it("VAT added on top is charged and stored", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor);
    await updateSalesSettings(actor, { taxMode: "added", taxRate: "16" });
    const result = await registerSale(actor, {
      lines: [{ productId, capture: "base", quantity: "10" }],
      payments: cash(),
      idempotencyKey: newId(),
    });
    expect(result).toMatchObject({ ok: true, total: "$17.40" });
    if (!result.ok) return;
    const sale = await db.sale.findUniqueOrThrow({
      where: { id: result.saleId },
    });
    expect([sale.subtotal, sale.tax, sale.total].map(String)).toEqual([
      "15",
      "2.4",
      "17.4",
    ]);
    expect(sale.pricesIncludeTax).toBe(false);
  });
});

describe("retries and the last unit (VEN-10)", () => {
  it("a double click sells once", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor);
    const sale: SaleInput = {
      lines: [{ productId, capture: "base", quantity: "4" }],
      payments: cash("10"),
      idempotencyKey: newId(),
    };
    const [a, b] = await Promise.all([
      registerSale(actor, sale),
      registerSale(actor, sale),
    ]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.saleId).toBe(b.saleId);
    expect([a.repeated, b.repeated].filter(Boolean)).toHaveLength(1);
    expect(b.change).toBe("$4.00");
    expect(await stockOf(productId)).toBe("996");
    expect(await findSaleByKey(actor, sale.idempotencyKey)).toEqual({
      saleId: a.saleId,
      number: 1,
    });
    // The same key for something else is refused.
    expect(
      await registerSale(actor, {
        ...sale,
        lines: [{ productId, capture: "base", quantity: "5" }],
      }),
    ).toMatchObject({ ok: false, formError: SALE_KEY_REUSED });
    await settled(actor.organizationId);
  });

  it("the last unit goes to one customer only", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor, "1");
    const one = () =>
      registerSale(actor, {
        lines: [{ productId, capture: "base", quantity: "1" }],
        payments: cash(),
        idempotencyKey: newId(),
      });
    const results = await Promise.all([one(), one(), one()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.lineErrors[0])),
    ).toEqual([
      expect.stringMatching(/Ya no hay/),
      expect.stringMatching(/Ya no hay/),
    ]);
    expect(await stockOf(productId)).toBe("0");
    await settled(actor.organizationId);
  });

  it("sales of different products at once take different numbers", async () => {
    const actor = await salesCompany();
    const products = await Promise.all([1, 2, 3, 4].map(() => screws(actor)));
    const results = await Promise.all(
      products.map(({ productId }) =>
        registerSale(actor, {
          lines: [{ productId, capture: "base", quantity: "1" }],
          payments: cash(),
          idempotencyKey: newId(),
        }),
      ),
    );
    expect(
      results.map((r) => (r.ok ? r.number : 0)).sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4]);
  });
});

describe("who sells", () => {
  it("the cashier sells; whoever only looks, or a company without Ventas, does not", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor);
    const sale = (): SaleInput => ({
      lines: [{ productId, capture: "base", quantity: "1" }],
      payments: cash(),
      idempotencyKey: newId(),
    });
    const cajero = await salesMember(actor.organizationId, "cashier");
    expect((await registerSale(cajero, sale())).ok).toBe(true);
    const consulta = await salesMember(actor.organizationId, "viewer");
    await expect(registerSale(consulta, sale())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await db.entitlement.deleteMany({
      where: { organizationId: actor.organizationId, key: "sales" },
    });
    invalidateEntitlements(actor.organizationId);
    await expect(registerSale(actor, sale())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("does not sell another company's products", async () => {
    const actor = await salesCompany();
    const other = await salesCompany();
    const { productId } = await screws(other);
    expect(
      await registerSale(actor, {
        lines: [{ productId, capture: "base", quantity: "1" }],
        payments: cash(),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      lineErrors: { 0: expect.stringMatching(/ya no existe/) },
    });
    expect(await stockOf(productId)).toBe("1000");
  });
});
