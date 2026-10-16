import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { getStockByLocation, reconcileStock } from "@/modules/inventory";
import {
  addOrderLine,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  getOrderReceipts,
  getPurchaseOrder,
  receivePurchaseOrder,
  submitPurchaseOrder,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { createSupplier } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-11: an order received in part is closed with its shortage, and a
// product still expected from a supplier is not archived (NEG-21).

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `cierreoc.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de cierre con faltante",
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

/**
 * An order sent to its supplier with the given lines: `base` asks in the
 * product's unit, `p:<id>` in a presentation.
 */
async function sentOrder(
  actor: PurchasingActor,
  lines: { productId: string; capture?: string; quantity: string }[],
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
    });
    if (!added.ok)
      throw new Error(`line setup failed: ${JSON.stringify(added)}`);
  }
  const sent = await submitPurchaseOrder(actor, order.orderId);
  if (!sent.ok) throw new Error("submit failed");
  return order.orderId;
}

const key = () => newId();
const statusOf = async (orderId: string) =>
  (await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).status;
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

/** Receives `quantity` of one line of an order (the first by default). */
async function receive(
  actor: PurchasingActor,
  orderId: string,
  quantity: string,
  line = 0,
) {
  const lines = await db.purchaseOrderLine.findMany({
    where: { orderId },
    orderBy: { lineNumber: "asc" },
  });
  const result = await receivePurchaseOrder(actor, orderId, {
    idempotencyKey: key(),
    lines: [{ orderLineId: lines[line]!.id, quantity }],
  });
  if (!result.ok) throw new Error(`receipt failed: ${JSON.stringify(result)}`);
  return result;
}

describe("closePurchaseOrder", () => {
  it("closes an order received in part with its shortage, once", async () => {
    const actor = await company();
    const tornillo = await product(actor);
    const clavo = await product(actor);
    const caja = await box(actor, clavo);
    const orderId = await sentOrder(actor, [
      { productId: tornillo, quantity: "100" },
      { productId: clavo, capture: `p:${caja}`, quantity: "3" },
    ]);
    await receive(actor, orderId, "60");
    expect(await statusOf(orderId)).toBe("PARTIAL");

    const closed = await closePurchaseOrder(actor, orderId, {
      reason: "El proveedor ya no tiene existencias",
    });
    expect(closed).toEqual({
      ok: true,
      status: "CLOSED",
      shortageText: `40 piezas de Tornillo ${skus - 1} y 3 cajas de Tornillo ${skus}`,
    });
    const order = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(order).toMatchObject({
      status: "CLOSED",
      closedByUserId: actor.userId,
      closeReason: "El proveedor ya no tiene existencias",
    });
    expect(order.closedAt).toBeInstanceOf(Date);
    // Nothing is invented for the rest: stock is what arrived.
    expect(await stockIn(actor, tornillo)).toBe("60");
    expect(await stockIn(actor, clavo)).toBe("0");
    expect(await db.purchaseReceipt.count({ where: { orderId } })).toBe(1);

    // The shortage stays in sight, and nothing more is received.
    const view = await getOrderReceipts(actor, orderId);
    expect(view?.canReceive).toBe(false);
    expect(view?.lines.map((line) => line.pendingText)).toEqual([
      "40 piezas",
      "3 cajas",
    ]);
    const late = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
    });
    expect(late).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(!late.ok && late.formError).toContain("se cerró con faltante");
    expect(await getPurchaseOrder(actor, orderId)).toMatchObject({
      statusLabel: "Cerrada con faltante",
      canClose: false,
      canCancel: false,
      closeReason: "El proveedor ya no tiene existencias",
    });

    // Twice closes once; the audit says what was missing.
    expect(
      await closePurchaseOrder(actor, orderId, { reason: "Otra vez" }),
    ).toMatchObject({ ok: true, repeated: true });
    const events = await db.auditEvent.findMany({
      where: { action: "purchase_order.closed", targetId: orderId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe("El proveedor ya no tiene existencias");
    expect(JSON.stringify(events[0]?.metadata)).toContain("40 piezas");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("only what was received in part closes; a reason is required", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "5" }]);

    const early = await closePurchaseOrder(actor, orderId, { reason: "Ya no" });
    expect(early).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(!early.ok && early.formError).toContain("cancélala");

    await receive(actor, orderId, "2");
    expect(await closePurchaseOrder(actor, orderId, { reason: " " })).toEqual({
      ok: false,
      reason: "invalid",
      fieldErrors: { reason: "Escribe por qué se cierra (al menos 3 letras)." },
    });
    await receive(actor, orderId, "3");
    const whole = await closePurchaseOrder(actor, orderId, { reason: "Ya no" });
    expect(whole).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(!whole.ok && whole.formError).toContain("recibió completa");
    expect(await statusOf(orderId)).toBe("RECEIVED");

    expect(
      await closePurchaseOrder(actor, newId(), { reason: "No existe" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("follows the matrix; an order of another company is not found", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "5" }]);
    await receive(actor, orderId, "1");

    for (const role of ["warehouse", "viewer"] as const) {
      await expect(
        closePurchaseOrder(await member(actor.organizationId, role), orderId, {
          reason: "Sin permiso",
        }),
      ).rejects.toMatchObject({ kind: "forbidden" });
    }
    const theirs = await company();
    expect(
      await closePurchaseOrder(theirs, orderId, { reason: "Colado" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await statusOf(orderId)).toBe("PARTIAL");

    const buyer = await member(actor.organizationId, "buyer");
    expect(
      await closePurchaseOrder(buyer, orderId, { reason: "No llegará" }),
    ).toMatchObject({ ok: true, status: "CLOSED" });
  });

  it("a receipt and a closing at once: one of them, consistent", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "10" }]);
    await receive(actor, orderId, "4");

    const [received, closed] = await Promise.all([
      receivePurchaseOrder(actor, orderId, { idempotencyKey: key() }),
      closePurchaseOrder(actor, orderId, { reason: "No llegará" }),
    ]);
    expect([received.ok, closed.ok].filter(Boolean)).toHaveLength(1);
    if (received.ok) {
      expect(await statusOf(orderId)).toBe("RECEIVED");
      expect(await stockIn(actor, productId)).toBe("10");
    } else {
      expect(await statusOf(orderId)).toBe("CLOSED");
      expect(await stockIn(actor, productId)).toBe("4");
    }
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("the database keeps the data of a closed order and its finality", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "5" }]);
    const set = (data: object) =>
      db.purchaseOrder.update({ where: { id: orderId }, data });
    const closing = {
      status: "CLOSED",
      closedAt: new Date(),
      closedByUserId: actor.userId,
      closeReason: "A la fuerza",
    };
    // Nothing received: it is cancelled, not closed.
    await expect(set(closing)).rejects.toThrow(/invalid state transition/);
    await receive(actor, orderId, "1");
    await expect(set({ ...closing, closeReason: "" })).rejects.toThrow(
      /purchase_order_state_check/,
    );
    await expect(set({ closedAt: new Date() })).rejects.toThrow(
      /purchase_order_state_check/,
    );
    await set(closing);
    await expect(set({ status: "RECEIVED" })).rejects.toThrow(
      /invalid state transition/,
    );
    expect(await statusOf(orderId)).toBe("CLOSED");
  });
});

describe("archiving a product still expected (CMP-11, NEG-21)", () => {
  it("is refused while an order waits for it; allowed once closed or cancelled", async () => {
    const actor = await company();
    const tornillo = await product(actor);
    const clavo = await product(actor);
    const cable = await product(actor);
    const partial = await sentOrder(actor, [
      { productId: tornillo, quantity: "4" },
      { productId: clavo, quantity: "5" },
    ]);
    const sent = await sentOrder(actor, [{ productId: cable, quantity: "2" }]);
    await receive(actor, partial, "4");

    const refused = await archiveProduct(actor, clavo);
    expect(refused).toMatchObject({ ok: false, reason: "has_open_orders" });
    expect(!refused.ok && refused.error).toContain("en la orden OC-0001");
    const other = await archiveProduct(actor, cable);
    expect(!other.ok && other.error).toContain("OC-0002");

    // Received in full, a line no longer waits: the stock is what stops it.
    expect(await archiveProduct(actor, tornillo)).toMatchObject({
      ok: false,
      reason: "has_stock",
    });

    expect(
      await closePurchaseOrder(actor, partial, { reason: "No llegará" }),
    ).toMatchObject({ ok: true });
    expect(await archiveProduct(actor, clavo)).toEqual({ ok: true });
    expect(
      await cancelPurchaseOrder(actor, sent, { reason: "Ya no se ocupa" }),
    ).toMatchObject({ ok: true });
    expect(await archiveProduct(actor, cable)).toEqual({ ok: true });
  });

  it("a draft does not stop it, but cannot be confirmed afterwards", async () => {
    const actor = await company();
    const productId = await product(actor);
    const supplier = await createSupplier(actor, { name: "Proveedor B" });
    if (!supplier.ok) throw new Error("supplier setup failed");
    const draft = await createPurchaseOrder(actor, {
      supplierId: supplier.supplierId,
    });
    if (!draft.ok) throw new Error("order setup failed");
    await addOrderLine(actor, draft.orderId, {
      productId,
      capture: "base",
      quantity: "3",
    });
    expect(await archiveProduct(actor, productId)).toEqual({ ok: true });
    const submitted = await submitPurchaseOrder(actor, draft.orderId);
    expect(!submitted.ok && submitted.formError).toContain("está archivado");
  });

  it("archiving and confirming the order at once: never a sent order of an archived product", async () => {
    for (let round = 0; round < 3; round++) {
      const actor = await company();
      const productId = await product(actor);
      const supplier = await createSupplier(actor, { name: "Proveedor C" });
      if (!supplier.ok) throw new Error("supplier setup failed");
      const draft = await createPurchaseOrder(actor, {
        supplierId: supplier.supplierId,
      });
      if (!draft.ok) throw new Error("order setup failed");
      await addOrderLine(actor, draft.orderId, {
        productId,
        capture: "base",
        quantity: "3",
      });
      const [archived, submitted] = await Promise.all([
        archiveProduct(actor, productId),
        submitPurchaseOrder(actor, draft.orderId),
      ]);
      expect([archived.ok, submitted.ok].filter(Boolean)).toHaveLength(1);
      const status = (
        await db.product.findUniqueOrThrow({ where: { id: productId } })
      ).status;
      expect(status).toBe(archived.ok ? "ARCHIVED" : "ACTIVE");
      expect(await statusOf(draft.orderId)).toBe(
        submitted.ok ? "SENT" : "DRAFT",
      );
    }
  });
});
