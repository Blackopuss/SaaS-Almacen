import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { getStockByLocation } from "@/modules/inventory";
import {
  addOrderLine,
  createPurchaseOrder,
  getOrderReceipts,
  getProductSupplier,
  linkProductSupplier,
  receivePurchaseOrder,
  submitPurchaseOrder,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  changePresentationFactor,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { createSupplier } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-13: receiving a purchase records what it cost — the last cost of
// the product at that supplier. No valuation: just the last price.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `costocompra.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de costos de compra",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function member(organizationId: string, role: Role) {
  const userId = await newUser();
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  await db.membershipRole.create({
    data: { id: newId(), organizationId, membershipId: membership.id, role },
  });
  return { organizationId, userId };
}

let skus = 0;
async function product(actor: PurchasingActor) {
  const created = await createProduct(actor, {
    sku: `R-${++skus}`,
    name: `Tornillo ${skus}`,
  });
  if (!created.ok) throw new Error("product setup failed");
  return created.productId;
}

async function box(actor: PurchasingActor, productId: string, factor = "100") {
  const created = await createPresentation(actor, productId, {
    name: "Caja",
    factor,
  });
  if (!created.ok) throw new Error("presentation setup failed");
  return created.presentationId;
}

const key = () => newId();
const stockIn = async (
  actor: PurchasingActor,
  productId: string,
  locationId?: string,
) => {
  const stock = await getStockByLocation(actor, productId);
  if (locationId) return stock[locationId] ?? "0";
  const general = await db.location.findFirstOrThrow({
    where: { organizationId: actor.organizationId, isDefault: true },
  });
  return stock[general.id] ?? "0";
};

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

/** A sent order of a supplier with lines that may carry a cost. */
async function costedOrder(
  actor: PurchasingActor,
  supplierId: string,
  lines: {
    productId: string;
    capture?: string;
    quantity: string;
    unitCost?: string;
  }[],
) {
  const order = await createPurchaseOrder(actor, { supplierId });
  if (!order.ok) throw new Error("order setup failed");
  for (const line of lines) {
    const added = await addOrderLine(actor, order.orderId, {
      productId: line.productId,
      capture: line.capture ?? "base",
      quantity: line.quantity,
      ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
    });
    if (!added.ok) throw new Error(`line failed: ${JSON.stringify(added)}`);
  }
  const sent = await submitPurchaseOrder(actor, order.orderId);
  if (!sent.ok) throw new Error("submit failed");
  return order.orderId;
}

async function supplierOf(actor: PurchasingActor, name: string) {
  const created = await createSupplier(actor, { name });
  if (!created.ok) throw new Error("supplier setup failed");
  return created.supplierId;
}

const linkOf = (productId: string, contactId: string) =>
  db.productSupplier.findFirst({ where: { productId, contactId } });

describe("last cost when receiving (CMP-13)", () => {
  it("records the cost of what arrived at that supplier, per what was bought", async () => {
    const actor = await company();
    const supplierId = await supplierOf(actor, "Ferretera del Norte");
    const clavo = await product(actor);
    const caja = await box(actor, clavo);
    const tornillo = await product(actor);
    const linked = await linkProductSupplier(actor, {
      productId: clavo,
      supplierId,
    });
    if (!linked.ok) throw new Error("link setup failed");
    const orderId = await costedOrder(actor, supplierId, [
      {
        productId: clavo,
        capture: `p:${caja}`,
        quantity: "3",
        unitCost: "250.5",
      },
      { productId: tornillo, quantity: "40", unitCost: "1.25" },
    ]);
    // The box changed before it arrived: the cost is for what came.
    await changePresentationFactor(actor, caja, {
      factor: "120",
      reason: "El proveedor cambió la caja",
    });
    expect(
      await receivePurchaseOrder(actor, orderId, { idempotencyKey: key() }),
    ).toMatchObject({ ok: true });

    const clavoLink = await linkOf(clavo, supplierId);
    expect(clavoLink?.lastCost?.toString()).toBe("250.5");
    expect(clavoLink?.lastCostAt).toBeInstanceOf(Date);
    const version = await db.presentationVersion.findFirstOrThrow({
      where: { presentationId: caja },
      orderBy: { version: "desc" },
    });
    expect(clavoLink?.lastCostPresentationVersionId).toBe(version.id);
    expect(await getProductSupplier(actor, linked.linkId)).toMatchObject({
      lastCost: { text: "$250.50 por caja de 120 piezas" },
    });
    // Bought from a supplier it was not linked to: now it is.
    const tornilloLink = await linkOf(tornillo, supplierId);
    expect(tornilloLink).toMatchObject({
      presentationId: null,
      lastCostPresentationVersionId: null,
      createdByUserId: actor.userId,
    });
    expect(tornilloLink?.lastCost?.toString()).toBe("1.25");
    // The receipt keeps what each line cost.
    const lines = await db.purchaseReceiptLine.findMany({
      where: { orderLine: { orderId } },
      orderBy: { lineNumber: "asc" },
    });
    expect(lines.map((line) => line.unitCost?.toString())).toEqual([
      "250.5",
      "1.25",
    ]);
  });

  it("each purchase replaces the last cost; a line without cost leaves it", async () => {
    const actor = await company();
    const supplierId = await supplierOf(actor, "Aceros del Bajío");
    const productId = await product(actor);
    const first = await costedOrder(actor, supplierId, [
      { productId, quantity: "10", unitCost: "12" },
    ]);
    const firstLine = await db.purchaseOrderLine.findFirstOrThrow({
      where: { orderId: first },
    });
    // Received in two parts: each records the cost.
    await receivePurchaseOrder(actor, first, {
      idempotencyKey: key(),
      lines: [{ orderLineId: firstLine.id, quantity: "4" }],
    });
    expect((await linkOf(productId, supplierId))?.lastCost?.toString()).toBe(
      "12",
    );
    const second = await costedOrder(actor, supplierId, [
      { productId, quantity: "5", unitCost: "13.5" },
    ]);
    await receivePurchaseOrder(actor, second, { idempotencyKey: key() });
    expect((await linkOf(productId, supplierId))?.lastCost?.toString()).toBe(
      "13.5",
    );
    const withoutCost = await costedOrder(actor, supplierId, [
      { productId, quantity: "1" },
    ]);
    await receivePurchaseOrder(actor, withoutCost, { idempotencyKey: key() });
    expect((await linkOf(productId, supplierId))?.lastCost?.toString()).toBe(
      "13.5",
    );
    // Another supplier keeps its own last cost.
    const other = await supplierOf(actor, "Otro proveedor");
    const third = await costedOrder(actor, other, [
      { productId, quantity: "1", unitCost: "9" },
    ]);
    await receivePurchaseOrder(actor, third, { idempotencyKey: key() });
    expect((await linkOf(productId, other))?.lastCost?.toString()).toBe("9");
    expect((await linkOf(productId, supplierId))?.lastCost?.toString()).toBe(
      "13.5",
    );
    expect(await stockIn(actor, productId)).toBe("11");
  });

  it("costs never leave the receipts for who may not see them (NEG-04)", async () => {
    const actor = await company();
    const supplierId = await supplierOf(actor, "Proveedor caro");
    const productId = await product(actor);
    const orderId = await costedOrder(actor, supplierId, [
      { productId, quantity: "2", unitCost: "4321.75" },
    ]);
    await receivePurchaseOrder(actor, orderId, { idempotencyKey: key() });
    const viewer = await member(actor.organizationId, "viewer");
    expect(JSON.stringify(await getOrderReceipts(viewer, orderId))).not.toMatch(
      /4321[.]75|4,321[.]75/,
    );
    expect(JSON.stringify(await getOrderReceipts(actor, orderId))).not.toMatch(
      /4321[.]75|4,321[.]75/,
    );
  });
});
