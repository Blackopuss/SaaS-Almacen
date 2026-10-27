import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { reconcileStock } from "@/modules/inventory";
import {
  addOrderLine,
  createPurchaseOrder,
  receivePurchaseOrder,
  returnToSupplier,
  submitPurchaseOrder,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createSupplier } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// VAL-02 (ADR 0031): receipts move the average cost with the cost of their
// order line; returns to the supplier take back what they came in at.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `valuacion.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<PurchasingActor> {
  const owner = await newUser();
  const created = await createOrganization(owner, {
    name: `Ferretería ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  if (!staff) {
    staff = await newUser();
    await db.platformStaff.create({ data: { userId: staff } });
  }
  const result = await provisionCompany(
    moduleRegistry,
    staff,
    created.organizationId,
    {
      productLimit: 30,
      users: 10,
      modules: ["inventory", "purchasing"],
      validUntil: null,
      reason: "Prueba de valuación",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

let skus = 0;
async function product(actor: PurchasingActor) {
  const created = await createProduct(actor, {
    sku: `V-${++skus}`,
    name: `Martillo ${skus}`,
  });
  if (!created.ok) throw new Error("product setup failed");
  return created.productId;
}

/** Sends an order and receives it in full. */
async function bought(
  actor: PurchasingActor,
  lines: {
    productId: string;
    capture?: string;
    quantity: string;
    unitCost?: string;
  }[],
) {
  const supplier = await createSupplier(actor, {
    name: `Proveedor ${newId().slice(-6)}`,
  });
  if (!supplier.ok) throw new Error("supplier setup failed");
  const order = await createPurchaseOrder(actor, {
    supplierId: supplier.supplierId,
  });
  if (!order.ok) throw new Error("order setup failed");
  for (const line of lines) {
    const added = await addOrderLine(actor, order.orderId, {
      productId: line.productId,
      capture: line.capture ?? "base",
      quantity: line.quantity,
      ...(line.unitCost ? { unitCost: line.unitCost } : {}),
    });
    if (!added.ok) throw new Error(`line failed: ${JSON.stringify(added)}`);
  }
  const sent = await submitPurchaseOrder(actor, order.orderId);
  if (!sent.ok) throw new Error("submit failed");
  const result = await receivePurchaseOrder(actor, order.orderId, {
    idempotencyKey: newId(),
  });
  if (!result.ok) throw new Error(`receipt failed: ${JSON.stringify(result)}`);
  return result.receiptId;
}

const costOf = async (productId: string) => {
  const row = await db.productCost.findFirst({ where: { productId } });
  return row
    ? {
        averageCost: row.averageCost.toFixed(6),
        stockValue: row.stockValue.toFixed(6),
      }
    : null;
};

const lineCosts = async (productId: string) =>
  (
    await db.stockMovementLine.findMany({
      where: { productId },
      orderBy: { createdAt: "asc" },
      select: { direction: true, unitCost: true },
    })
  ).map((line) => `${line.direction} ${line.unitCost?.toFixed(2) ?? "-"}`);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("receipts value the inventory", () => {
  it("10 at $85 + 10 at $95 → $90", async () => {
    const actor = await company();
    const martillo = await product(actor);
    await bought(actor, [
      { productId: martillo, quantity: "10", unitCost: "85" },
    ]);
    expect(await costOf(martillo)).toEqual({
      averageCost: "85.000000",
      stockValue: "850.000000",
    });
    await bought(actor, [
      { productId: martillo, quantity: "10", unitCost: "95" },
    ]);
    expect(await costOf(martillo)).toEqual({
      averageCost: "90.000000",
      stockValue: "1800.000000",
    });
    expect(await lineCosts(martillo)).toEqual(["IN 85.00", "IN 95.00"]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("a box comes in at its cost ÷ its content", async () => {
    const actor = await company();
    const tornillo = await product(actor);
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "500",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    await bought(actor, [
      {
        productId: tornillo,
        capture: `p:${caja.presentationId}`,
        quantity: "2",
        unitCost: "450",
      },
    ]);
    // $450 per box of 500 = $0.90 per screw; 1,000 screws = $900.
    expect(await costOf(tornillo)).toEqual({
      averageCost: "0.900000",
      stockValue: "900.000000",
    });
  });

  it("without a cost it comes in at the average, or stays unvalued", async () => {
    const actor = await company();
    const valued = await product(actor);
    const unknown = await product(actor);
    await bought(actor, [
      { productId: valued, quantity: "4", unitCost: "10" },
      { productId: unknown, quantity: "4" },
    ]);
    await bought(actor, [{ productId: valued, quantity: "6" }]);
    expect(await costOf(valued)).toEqual({
      averageCost: "10.000000",
      stockValue: "100.000000",
    });
    expect(await lineCosts(valued)).toEqual(["IN 10.00", "IN 10.00"]);
    expect(await costOf(unknown)).toBeNull();
    expect(await lineCosts(unknown)).toEqual(["IN -"]);
  });
});

describe("returns to the supplier", () => {
  it("take back what they came in at", async () => {
    const actor = await company();
    const martillo = await product(actor);
    await bought(actor, [
      { productId: martillo, quantity: "10", unitCost: "85" },
    ]);
    const receiptId = await bought(actor, [
      { productId: martillo, quantity: "10", unitCost: "95" },
    ]);
    const [line] = await db.purchaseReceiptLine.findMany({
      where: { receiptId },
    });
    const result = await returnToSupplier(actor, receiptId, {
      reason: "Llegó dañado",
      idempotencyKey: newId(),
      lines: [{ receiptLineId: line!.id, quantity: "10" }],
    });
    expect(result).toMatchObject({ ok: true });
    // The ten at $95 leave: what stays is worth $85 each.
    expect(await costOf(martillo)).toEqual({
      averageCost: "85.000000",
      stockValue: "850.000000",
    });
    expect(await lineCosts(martillo)).toEqual([
      "IN 85.00",
      "IN 95.00",
      "OUT 95.00",
    ]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});
