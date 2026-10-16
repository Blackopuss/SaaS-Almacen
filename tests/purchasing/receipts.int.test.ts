import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  reconcileStock,
  reverseMovement,
} from "@/modules/inventory";
import {
  addOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  findReceiptConfirmation,
  getOrderReceipts,
  receivePurchaseOrder,
  submitPurchaseOrder,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  changePresentationFactor,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { createSupplier } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { archiveLocation, createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-07: receiving an order. The receipt, the entry of stock and the new
// state of the order are written in one transaction: all or nothing.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `recepcion.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de recepciones",
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

describe("receivePurchaseOrder", () => {
  it("receives everything: stock enters, the receipt exists and the order is received", async () => {
    const actor = await company();
    const screws = await product(actor);
    const nails = await product(actor);
    const caja = await box(actor, nails, "100");
    const orderId = await sentOrder(actor, [
      { productId: screws, quantity: "25" },
      { productId: nails, capture: `p:${caja}`, quantity: "3" },
    ]);

    const result = await receivePurchaseOrder(actor, orderId, {
      reference: "Remisión 4411",
      idempotencyKey: key(),
    });
    expect(result).toMatchObject({ ok: true, status: "RECEIVED" });
    expect(await statusOf(orderId)).toBe("RECEIVED");
    expect(await stockIn(actor, screws)).toBe("25");
    expect(await stockIn(actor, nails)).toBe("300");

    const receipt = await db.purchaseReceipt.findFirstOrThrow({
      where: { orderId },
      include: { lines: { orderBy: { lineNumber: "asc" } }, movement: true },
    });
    expect(receipt.reference).toBe("Remisión 4411");
    expect(receipt.movement.type).toBe("RECEIPT");
    expect(receipt.movement.reference).toMatch(/^OC-\d{4} · Remisión 4411$/);
    expect(
      receipt.lines.map((line) => [
        line.capturedQuantity.toString(),
        line.factor.toString(),
        line.baseQuantity.toString(),
      ]),
    ).toEqual([
      ["25", "1", "25"],
      ["3", "100", "300"],
    ]);

    const view = await getOrderReceipts(actor, orderId);
    expect(view?.canReceive).toBe(false);
    expect(view?.lines.map((line) => line.pendingText)).toEqual([null, null]);
    expect(view?.receipts[0]?.lines[1]?.quantityText).toBe(
      "3 cajas × 100 = 300 piezas",
    );
    expect(
      await db.auditEvent.count({
        where: { action: "purchase_order.received", targetId: orderId },
      }),
    ).toBe(1);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("puts it in the chosen location", async () => {
    const actor = await company();
    const productId = await product(actor);
    const shelf = await createLocation(actor, { kind: "SHELF", name: "A-01" });
    if (!shelf.ok) throw new Error("location setup failed");
    const orderId = await sentOrder(actor, [{ productId, quantity: "8" }]);

    const result = await receivePurchaseOrder(actor, orderId, {
      locationId: shelf.locationId,
      idempotencyKey: key(),
    });
    expect(result).toMatchObject({ ok: true });
    expect(await stockIn(actor, productId, shelf.locationId)).toBe("8");
    expect(await stockIn(actor, productId)).toBe("0");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("uses the content of the box in force when it arrives", async () => {
    const actor = await company();
    const productId = await product(actor);
    const caja = await box(actor, productId, "100");
    const orderId = await sentOrder(actor, [
      { productId, capture: `p:${caja}`, quantity: "2" },
    ]);
    const changed = await changePresentationFactor(actor, caja, {
      factor: "120",
      reason: "El proveedor cambió la caja",
    });
    expect(changed).toMatchObject({ ok: true });

    await receivePurchaseOrder(actor, orderId, { idempotencyKey: key() });
    expect(await stockIn(actor, productId)).toBe("240");
    const line = await db.purchaseReceiptLine.findFirstOrThrow({
      where: { productId },
    });
    expect(line.factor.toString()).toBe("120");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("the same confirmation twice receives once", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "10" }]);
    const idempotencyKey = key();

    const [first, second] = await Promise.all([
      receivePurchaseOrder(actor, orderId, { idempotencyKey }),
      receivePurchaseOrder(actor, orderId, { idempotencyKey }),
    ]);
    expect([first.ok, second.ok]).toEqual([true, true]);
    expect([first, second].filter((r) => r.ok && r.repeated)).toHaveLength(1);
    expect(await stockIn(actor, productId)).toBe("10");
    expect(await db.purchaseReceipt.count({ where: { orderId } })).toBe(1);
    expect(await findReceiptConfirmation(actor, idempotencyKey)).toMatchObject({
      orderId,
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("two different confirmations at once receive once", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "10" }]);

    const results = await Promise.all([
      receivePurchaseOrder(actor, orderId, { idempotencyKey: key() }),
      receivePurchaseOrder(actor, orderId, { idempotencyKey: key() }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      ok: false,
      reason: "invalid_transition",
    });
    expect(await stockIn(actor, productId)).toBe("10");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("a key used for another order is refused", async () => {
    const actor = await company();
    const productId = await product(actor);
    const first = await sentOrder(actor, [{ productId, quantity: "1" }]);
    const second = await sentOrder(actor, [{ productId, quantity: "1" }]);
    const idempotencyKey = key();
    await receivePurchaseOrder(actor, first, { idempotencyKey });
    const reused = await receivePurchaseOrder(actor, second, {
      idempotencyKey,
    });
    expect(reused).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await statusOf(second)).toBe("SENT");
  });

  it("only orders waiting for goods are received", async () => {
    const actor = await company();
    const productId = await product(actor);
    const supplier = await createSupplier(actor, { name: "Borradores SA" });
    if (!supplier.ok) throw new Error("supplier setup failed");
    const draft = await createPurchaseOrder(actor, {
      supplierId: supplier.supplierId,
    });
    if (!draft.ok) throw new Error("order setup failed");
    await addOrderLine(actor, draft.orderId, {
      productId,
      capture: "base",
      quantity: "4",
    });
    expect(
      await receivePurchaseOrder(actor, draft.orderId, {
        idempotencyKey: key(),
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid_transition",
      formError: "Primero confirma la orden como enviada; después se recibe.",
    });

    const cancelled = await sentOrder(actor, [{ productId, quantity: "4" }]);
    await cancelPurchaseOrder(actor, cancelled, { reason: "Ya no se ocupa" });
    expect(
      await receivePurchaseOrder(actor, cancelled, { idempotencyKey: key() }),
    ).toMatchObject({ ok: false, reason: "invalid_transition" });

    const done = await sentOrder(actor, [{ productId, quantity: "4" }]);
    await receivePurchaseOrder(actor, done, { idempotencyKey: key() });
    expect(
      await receivePurchaseOrder(actor, done, { idempotencyKey: key() }),
    ).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(await stockIn(actor, productId)).toBe("4");
  });

  it("nothing is written when a product was archived or the location is archived", async () => {
    const actor = await company();
    const kept = await product(actor);
    const archived = await product(actor);
    const orderId = await sentOrder(actor, [
      { productId: kept, quantity: "2" },
      { productId: archived, quantity: "2" },
    ]);
    expect(await archiveProduct(actor, archived)).toMatchObject({ ok: true });
    const refused = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
    });
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    expect(refused.ok ? "" : refused.formError).toMatch(/archivado/);
    expect(await stockIn(actor, kept)).toBe("0");
    expect(await statusOf(orderId)).toBe("SENT");
    expect(await db.purchaseReceipt.count({ where: { orderId } })).toBe(0);

    const other = await sentOrder(actor, [{ productId: kept, quantity: "2" }]);
    const shelf = await createLocation(actor, { kind: "SHELF", name: "B-02" });
    if (!shelf.ok) throw new Error("location setup failed");
    expect(await archiveLocation(actor, shelf.locationId)).toMatchObject({
      ok: true,
    });
    expect(
      await receivePurchaseOrder(actor, other, {
        locationId: shelf.locationId,
        idempotencyKey: key(),
      }),
    ).toMatchObject({ ok: false, fieldErrors: { locationId: /archivada/ } });
    expect(await statusOf(other)).toBe("SENT");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("validates what the form sends", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "1" }]);
    expect(
      await receivePurchaseOrder(actor, orderId, {
        reference: "x".repeat(81),
        idempotencyKey: key(),
      }),
    ).toMatchObject({ ok: false, fieldErrors: { reference: /80/ } });
    expect(
      await receivePurchaseOrder(actor, orderId, { idempotencyKey: "corta" }),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("who may receive", () => {
  it("buyers receive; viewers and warehouse do not, and see nothing written", async () => {
    const owner = await company();
    const productId = await product(owner);
    const orderId = await sentOrder(owner, [{ productId, quantity: "3" }]);

    for (const role of ["viewer", "warehouse"] as const) {
      const person = await member(owner.organizationId, role);
      await expect(
        receivePurchaseOrder(person, orderId, { idempotencyKey: key() }),
      ).rejects.toMatchObject({ kind: "forbidden" });
    }
    expect(await statusOf(orderId)).toBe("SENT");

    const buyer = await member(owner.organizationId, "buyer");
    expect(
      await receivePurchaseOrder(buyer, orderId, { idempotencyKey: key() }),
    ).toMatchObject({ ok: true });
    // Consulta sees what arrived.
    const viewer = await member(owner.organizationId, "viewer");
    expect((await getOrderReceipts(viewer, orderId))?.receipts).toHaveLength(1);
  });

  it("an order of another company is not found", async () => {
    const mine = await company();
    const theirs = await company();
    const productId = await product(theirs);
    const orderId = await sentOrder(theirs, [{ productId, quantity: "3" }]);
    expect(
      await receivePurchaseOrder(mine, orderId, { idempotencyKey: key() }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await getOrderReceipts(mine, orderId)).toBeNull();
    expect(await statusOf(orderId)).toBe("SENT");
  });

  it("the location must be of the company", async () => {
    const mine = await company();
    const theirs = await company();
    const shelf = await createLocation(theirs, { kind: "SHELF", name: "Z-9" });
    if (!shelf.ok) throw new Error("location setup failed");
    const productId = await product(mine);
    const orderId = await sentOrder(mine, [{ productId, quantity: "3" }]);
    expect(
      await receivePurchaseOrder(mine, orderId, {
        locationId: shelf.locationId,
        idempotencyKey: key(),
      }),
    ).toMatchObject({ ok: false, fieldErrors: { locationId: /no existe/ } });
    expect(await statusOf(orderId)).toBe("SENT");
  });
});

describe("a receipt is corrected from Compras, not from Inventario (NEG-22)", () => {
  it("its movement is not reversed", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "6" }]);
    await receivePurchaseOrder(actor, orderId, { idempotencyKey: key() });
    const receipt = await db.purchaseReceipt.findFirstOrThrow({
      where: { orderId },
    });
    expect(
      await reverseMovement(actor, {
        movementId: receipt.movementId,
        reason: "Me equivoqué",
        idempotencyKey: key(),
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await stockIn(actor, productId)).toBe("6");
  });

  it("the database keeps receipts as history", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "6" }]);
    await receivePurchaseOrder(actor, orderId, { idempotencyKey: key() });
    const receipt = await db.purchaseReceipt.findFirstOrThrow({
      where: { orderId },
      include: { lines: true },
    });
    await expect(
      db.purchaseReceipt.update({
        where: { id: receipt.id },
        data: { reference: "otra" },
      }),
    ).rejects.toThrow();
    await expect(
      db.purchaseReceiptLine.delete({ where: { id: receipt.lines[0]!.id } }),
    ).rejects.toThrow();
  });
});

describe("partial receipts (CMP-08)", () => {
  it("60 of 100 leaves the order received in part with 40 pending", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "100" }]);
    const [line] = await db.purchaseOrderLine.findMany({ where: { orderId } });

    const first = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
      lines: [{ orderLineId: line!.id, quantity: "60" }],
    });
    expect(first).toMatchObject({ ok: true, status: "PARTIAL" });
    expect(first.ok && first.summary).toMatch(/recibida en parte/);
    expect(await statusOf(orderId)).toBe("PARTIAL");
    expect(await stockIn(actor, productId)).toBe("60");
    const view = await getOrderReceipts(actor, orderId);
    expect(view).toMatchObject({
      canReceive: true,
      lines: [
        {
          receivedText: "60 piezas",
          pendingText: "40 piezas",
          pendingQuantity: "40",
        },
      ],
    });

    // A received-in-part order is not cancelled.
    expect(
      await cancelPurchaseOrder(actor, orderId, { reason: "Ya no llega" }),
    ).toMatchObject({ ok: false, reason: "invalid_transition" });

    // The rest arrives: without lines, everything pending.
    const rest = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
    });
    expect(rest).toMatchObject({ ok: true, status: "RECEIVED" });
    expect(await stockIn(actor, productId)).toBe("100");
    expect((await getOrderReceipts(actor, orderId))?.receipts).toHaveLength(2);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("lines that did not arrive stay pending; boxes are counted as ordered", async () => {
    const actor = await company();
    const screws = await product(actor);
    const nails = await product(actor);
    const caja = await box(actor, nails, "100");
    const orderId = await sentOrder(actor, [
      { productId: screws, quantity: "25" },
      { productId: nails, capture: `p:${caja}`, quantity: "3" },
    ]);
    const lines = await db.purchaseOrderLine.findMany({
      where: { orderId },
      orderBy: { lineNumber: "asc" },
    });

    const result = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
      lines: [
        { orderLineId: lines[0]!.id, quantity: "0" },
        { orderLineId: lines[1]!.id, quantity: "1" },
      ],
    });
    expect(result).toMatchObject({ ok: true, status: "PARTIAL" });
    expect(await stockIn(actor, screws)).toBe("0");
    expect(await stockIn(actor, nails)).toBe("100");
    const view = await getOrderReceipts(actor, orderId);
    expect(view?.lines.map((line) => line.pendingText)).toEqual([
      "25 piezas",
      "2 cajas",
    ]);
    expect(view?.lines[1]?.unitText).toBe("cajas");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("never receives more than what is pending, nor broken boxes", async () => {
    const actor = await company();
    const screws = await product(actor);
    const nails = await product(actor);
    const caja = await box(actor, nails, "100");
    const orderId = await sentOrder(actor, [
      { productId: screws, quantity: "10" },
      { productId: nails, capture: `p:${caja}`, quantity: "2" },
    ]);
    const lines = await db.purchaseOrderLine.findMany({
      where: { orderId },
      orderBy: { lineNumber: "asc" },
    });

    const refused = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
      lines: [
        { orderLineId: lines[0]!.id, quantity: "11" },
        { orderLineId: lines[1]!.id, quantity: "1.5" },
      ],
    });
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    const errors = refused.ok ? {} : (refused.lineErrors ?? {});
    expect(errors[lines[0]!.id]).toMatch(/Solo faltan 10 piezas/);
    expect(errors[lines[1]!.id]).toMatch(/cajas completas/);
    expect(await statusOf(orderId)).toBe("SENT");
    expect(await db.purchaseReceipt.count({ where: { orderId } })).toBe(0);

    await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
      lines: [{ orderLineId: lines[0]!.id, quantity: "10" }],
    });
    const again = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
      lines: [{ orderLineId: lines[0]!.id, quantity: "1" }],
    });
    expect(again.ok ? {} : again.lineErrors).toMatchObject({
      [lines[0]!.id]: /ya llegó completo/,
    });
    expect(await stockIn(actor, screws)).toBe("10");
  });

  it("nothing typed, or lines of another order, are refused", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "5" }]);
    const other = await sentOrder(actor, [{ productId, quantity: "5" }]);
    const [line] = await db.purchaseOrderLine.findMany({ where: { orderId } });
    const [foreign] = await db.purchaseOrderLine.findMany({
      where: { orderId: other },
    });

    expect(
      await receivePurchaseOrder(actor, orderId, {
        idempotencyKey: key(),
        lines: [{ orderLineId: line!.id, quantity: "" }],
      }),
    ).toMatchObject({ ok: false, formError: /al menos un producto/ });
    expect(
      await receivePurchaseOrder(actor, orderId, {
        idempotencyKey: key(),
        lines: [{ orderLineId: foreign!.id, quantity: "5" }],
      }),
    ).toMatchObject({ ok: false, formError: /no corresponde/ });
    expect(
      await receivePurchaseOrder(actor, orderId, {
        idempotencyKey: key(),
        lines: [
          { orderLineId: line!.id, quantity: "2" },
          { orderLineId: line!.id, quantity: "2" },
        ],
      }),
    ).toMatchObject({ ok: false, formError: /no corresponde/ });
    expect(await statusOf(orderId)).toBe("SENT");
    expect(await statusOf(other)).toBe("SENT");
  });
});

describe("destination and presentation when receiving (CMP-09)", () => {
  it("2 boxes into A-01 are 200 pieces in A-01; each line may go elsewhere", async () => {
    const actor = await company();
    const nails = await product(actor);
    const screws = await product(actor);
    const caja = await box(actor, nails, "100");
    const a01 = await createLocation(actor, { kind: "SHELF", name: "A-01" });
    const b02 = await createLocation(actor, { kind: "SHELF", name: "B-02" });
    if (!a01.ok || !b02.ok) throw new Error("location setup failed");
    const orderId = await sentOrder(actor, [
      { productId: nails, capture: `p:${caja}`, quantity: "2" },
      { productId: screws, quantity: "30" },
    ]);
    const lines = await db.purchaseOrderLine.findMany({
      where: { orderId },
      orderBy: { lineNumber: "asc" },
    });

    const result = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
      locationId: a01.locationId,
      lines: [
        { orderLineId: lines[0]!.id, quantity: "2" },
        {
          orderLineId: lines[1]!.id,
          quantity: "30",
          locationId: b02.locationId,
        },
      ],
    });
    expect(result).toMatchObject({ ok: true, status: "RECEIVED" });
    expect(result.ok && result.summary).toMatch(/en A-01 y B-02/);
    expect(await stockIn(actor, nails, a01.locationId)).toBe("200");
    expect(await stockIn(actor, screws, b02.locationId)).toBe("30");
    expect(await stockIn(actor, screws, a01.locationId)).toBe("0");
    const view = await getOrderReceipts(actor, orderId);
    expect(view?.receipts[0]?.lines.map((line) => line.locationPath)).toEqual([
      "A-01",
      "B-02",
    ]);
    const movementLines = await db.stockMovementLine.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { lineNumber: "asc" },
    });
    expect(movementLines.map((line) => line.locationId)).toEqual([
      a01.locationId,
      b02.locationId,
    ]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("shows the content in force and the difference with the order", async () => {
    const actor = await company();
    const productId = await product(actor);
    const caja = await box(actor, productId, "100");
    const orderId = await sentOrder(actor, [
      { productId, capture: `p:${caja}`, quantity: "2" },
    ]);
    expect((await getOrderReceipts(actor, orderId))?.lines[0]).toMatchObject({
      contentText: "1 caja = 100 piezas",
      orderedContentText: null,
    });
    await changePresentationFactor(actor, caja, {
      factor: "120",
      reason: "Caja nueva del proveedor",
    });
    expect((await getOrderReceipts(actor, orderId))?.lines[0]).toMatchObject({
      contentText: "1 caja = 120 piezas",
      orderedContentText: "1 caja = 100 piezas",
    });
    const [line] = await db.purchaseOrderLine.findMany({ where: { orderId } });
    await receivePurchaseOrder(actor, orderId, {
      idempotencyKey: key(),
      lines: [{ orderLineId: line!.id, quantity: "1" }],
    });
    expect(await stockIn(actor, productId)).toBe("120");
    expect(
      (await getOrderReceipts(actor, orderId))?.receipts[0]?.lines[0]
        ?.quantityText,
    ).toBe("1 caja × 120 = 120 piezas");
  });

  it("a line location of another company or archived is refused on its line", async () => {
    const mine = await company();
    const theirs = await company();
    const foreign = await createLocation(theirs, { kind: "SHELF", name: "X" });
    const old = await createLocation(mine, { kind: "SHELF", name: "Vieja" });
    if (!foreign.ok || !old.ok) throw new Error("location setup failed");
    await archiveLocation(mine, old.locationId);
    const productId = await product(mine);
    const orderId = await sentOrder(mine, [{ productId, quantity: "3" }]);
    const [line] = await db.purchaseOrderLine.findMany({ where: { orderId } });

    for (const [locationId, message] of [
      [foreign.locationId, /no existe/],
      [old.locationId, /archivada/],
    ] as const) {
      const refused = await receivePurchaseOrder(mine, orderId, {
        idempotencyKey: key(),
        lines: [{ orderLineId: line!.id, quantity: "3", locationId }],
      });
      expect(refused.ok ? {} : refused.lineErrors).toMatchObject({
        [line!.id]: message,
      });
    }
    expect(await statusOf(orderId)).toBe("SENT");
    expect(await db.purchaseReceipt.count({ where: { orderId } })).toBe(0);
  });
});

describe("concurrent and repeated receipts (CMP-10, NEG-24)", () => {
  it("five receipts of 1 at once against 3 pending receive exactly 3", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "3" }]);
    const [line] = await db.purchaseOrderLine.findMany({ where: { orderId } });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        receivePurchaseOrder(actor, orderId, {
          idempotencyKey: key(),
          lines: [{ orderLineId: line!.id, quantity: "1" }],
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    for (const refused of results.filter((r) => !r.ok)) {
      expect(refused).toMatchObject({
        ok: false,
        reason: "invalid_transition",
      });
    }
    expect(await stockIn(actor, productId)).toBe("3");
    expect(await statusOf(orderId)).toBe("RECEIVED");
    expect(await db.purchaseReceipt.count({ where: { orderId } })).toBe(3);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("two partial receipts at once never add up to more than pending", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "10" }]);
    const [line] = await db.purchaseOrderLine.findMany({ where: { orderId } });

    const results = await Promise.all(
      ["7", "6"].map((quantity) =>
        receivePurchaseOrder(actor, orderId, {
          idempotencyKey: key(),
          lines: [{ orderLineId: line!.id, quantity }],
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused?.ok ? {} : refused?.lineErrors).toMatchObject({
      [line!.id]: /Solo faltan/,
    });
    const received = await stockIn(actor, productId);
    expect(["6", "7"]).toContain(received);
    expect(await statusOf(orderId)).toBe("PARTIAL");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("a key sent again with other quantities is refused, not taken as a retry", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "10" }]);
    const [line] = await db.purchaseOrderLine.findMany({ where: { orderId } });
    const idempotencyKey = key();

    const first = await receivePurchaseOrder(actor, orderId, {
      idempotencyKey,
      lines: [{ orderLineId: line!.id, quantity: "4" }],
    });
    expect(first).toMatchObject({ ok: true, status: "PARTIAL" });
    expect(
      await receivePurchaseOrder(actor, orderId, {
        idempotencyKey,
        lines: [{ orderLineId: line!.id, quantity: "4" }],
      }),
    ).toMatchObject({ ok: true, repeated: true });
    expect(
      await receivePurchaseOrder(actor, orderId, {
        idempotencyKey,
        lines: [{ orderLineId: line!.id, quantity: "5" }],
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    // Another person with the same key does not see the receipt as theirs.
    const buyer = await member(actor.organizationId, "buyer");
    expect(
      await receivePurchaseOrder(buyer, orderId, {
        idempotencyKey,
        lines: [{ orderLineId: line!.id, quantity: "4" }],
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await findReceiptConfirmation(buyer, idempotencyKey)).toBeNull();
    expect(await stockIn(actor, productId)).toBe("4");
  });

  it("a receipt and a cancellation at once: one of them, never both", async () => {
    const actor = await company();
    const productId = await product(actor);
    const orderId = await sentOrder(actor, [{ productId, quantity: "5" }]);

    const [received, cancelled] = await Promise.all([
      receivePurchaseOrder(actor, orderId, { idempotencyKey: key() }),
      cancelPurchaseOrder(actor, orderId, { reason: "Ya no se ocupa" }),
    ]);
    expect([received.ok, cancelled.ok].filter(Boolean)).toHaveLength(1);
    const status = await statusOf(orderId);
    if (received.ok) {
      expect(status).toBe("RECEIVED");
      expect(await stockIn(actor, productId)).toBe("5");
    } else {
      expect(status).toBe("CANCELLED");
      expect(await stockIn(actor, productId)).toBe("0");
    }
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("archiving the destination at the same time never leaves stock in an archived location", async () => {
    const actor = await company();
    const productId = await product(actor);
    const shelf = await createLocation(actor, { kind: "SHELF", name: "C-03" });
    if (!shelf.ok) throw new Error("location setup failed");
    const orderId = await sentOrder(actor, [{ productId, quantity: "5" }]);

    const [received, archived] = await Promise.all([
      receivePurchaseOrder(actor, orderId, {
        idempotencyKey: key(),
        locationId: shelf.locationId,
      }),
      archiveLocation(actor, shelf.locationId),
    ]);
    // Archiving a location with stock is refused, so at most one wins.
    expect(received.ok && archived.ok).toBe(false);
    const location = await db.location.findUniqueOrThrow({
      where: { id: shelf.locationId },
    });
    if (received.ok) {
      expect(location.archivedAt).toBeNull();
      expect(await stockIn(actor, productId, shelf.locationId)).toBe("5");
    } else {
      expect(location.archivedAt).not.toBeNull();
      expect(await statusOf(orderId)).toBe("SENT");
    }
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});
