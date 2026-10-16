import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  reconcileStock,
  registerExit,
  reverseMovement,
} from "@/modules/inventory";
import {
  addOrderLine,
  createPurchaseOrder,
  findReturnConfirmation,
  getOrderReceipts,
  receivePurchaseOrder,
  returnToSupplier,
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
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-12: returns to the supplier. The return and the exit of stock are
// written together; what goes back of a receipt line never exceeds what
// it received, whatever arrives at once or twice (NEG-24).

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `devolucion.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de devoluciones",
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

/** An order received in full; returns its receipt and its lines. */
async function received(
  actor: PurchasingActor,
  lines: { productId: string; capture?: string; quantity: string }[],
  locationId?: string,
) {
  const orderId = await sentOrder(actor, lines);
  const result = await receivePurchaseOrder(actor, orderId, {
    idempotencyKey: key(),
    ...(locationId ? { locationId } : {}),
  });
  if (!result.ok) throw new Error(`receipt failed: ${JSON.stringify(result)}`);
  const receiptLines = await db.purchaseReceiptLine.findMany({
    where: { receiptId: result.receiptId },
    orderBy: { lineNumber: "asc" },
  });
  return { orderId, receiptId: result.receiptId, receiptLines };
}

const back = (
  actor: PurchasingActor,
  receiptId: string,
  lines: { receiptLineId: string; quantity: string; locationId?: string }[],
  reason = "Llegó dañado",
  idempotencyKey = key(),
) => returnToSupplier(actor, receiptId, { reason, idempotencyKey, lines });

describe("returnToSupplier", () => {
  it("takes it out of stock with the factor it was received with, in one document", async () => {
    const actor = await company();
    const clavo = await product(actor);
    const caja = await box(actor, clavo);
    const { orderId, receiptId, receiptLines } = await received(actor, [
      { productId: clavo, capture: `p:${caja}`, quantity: "3" },
    ]);
    const lineId = receiptLines[0]!.id;
    expect(await stockIn(actor, clavo)).toBe("300");

    const first = await back(actor, receiptId, [
      { receiptLineId: lineId, quantity: "1" },
    ]);
    expect(first).toMatchObject({
      ok: true,
      summary: `Devolviste 1 caja de Tornillo ${skus} (100 piezas) de OC-0001.`,
    });
    expect(await stockIn(actor, clavo)).toBe("200");
    // The box now holds 120, but what entered for it was 100.
    await changePresentationFactor(actor, caja, {
      factor: "120",
      reason: "El proveedor cambió la caja",
    });
    expect(
      await back(actor, receiptId, [{ receiptLineId: lineId, quantity: "1" }]),
    ).toMatchObject({ ok: true });
    expect(await stockIn(actor, clavo)).toBe("100");

    const returns = await db.purchaseReturn.findMany({
      where: { receiptId },
      include: { lines: true, movement: { include: { lines: true } } },
    });
    expect(returns).toHaveLength(2);
    for (const row of returns) {
      expect(row.reason).toBe("Llegó dañado");
      expect(row.movement.type).toBe("RETURN");
      expect(row.movement.reference).toBe("OC-0001 · Devolución");
      expect(row.movement.lines).toHaveLength(1);
      expect(row.movement.lines[0]).toMatchObject({
        direction: "OUT",
        presentationId: caja,
      });
      expect(row.movement.lines[0]!.baseQuantity.toString()).toBe("100");
      expect(row.lines[0]!.factor.toString()).toBe("100");
    }
    // The order stays as it was; the receipt shows what went back.
    expect(await statusOf(orderId)).toBe("RECEIVED");
    const view = await getOrderReceipts(actor, orderId);
    expect(view?.canReturn).toBe(true);
    expect(view?.receipts[0]?.lines[0]).toMatchObject({
      returnedText: "2 cajas",
      returnableText: "1 caja",
      returnableQuantity: "1",
    });
    expect(view?.receipts[0]?.returns).toHaveLength(2);
    expect(view?.receipts[0]?.returns?.[0]).toMatchObject({
      reason: "Llegó dañado",
      lines: [{ quantityText: "1 caja × 100 = 100 piezas" }],
    });
    expect(
      await db.auditEvent.count({
        where: { action: "purchase_order.returned", targetId: orderId },
      }),
    ).toBe(2);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("never more than what the line received, adding every return", async () => {
    const actor = await company();
    const clavo = await product(actor);
    const caja = await box(actor, clavo);
    const { receiptId, receiptLines } = await received(actor, [
      { productId: clavo, capture: `p:${caja}`, quantity: "3" },
    ]);
    const lineId = receiptLines[0]!.id;

    const tooMuch = await back(actor, receiptId, [
      { receiptLineId: lineId, quantity: "4" },
    ]);
    expect(tooMuch).toMatchObject({
      ok: false,
      reason: "invalid",
      lineErrors: {
        [lineId]:
          "De esta recepción llegaron 3 cajas: no se devuelve más de eso.",
      },
    });
    expect(
      await back(actor, receiptId, [{ receiptLineId: lineId, quantity: "2" }]),
    ).toMatchObject({ ok: true });
    expect(
      await back(actor, receiptId, [{ receiptLineId: lineId, quantity: "2" }]),
    ).toMatchObject({
      ok: false,
      lineErrors: {
        [lineId]: "Solo puedes devolver 1 caja: lo demás ya se devolvió.",
      },
    });
    expect(
      await back(actor, receiptId, [
        { receiptLineId: lineId, quantity: "0.5" },
      ]),
    ).toMatchObject({
      ok: false,
      lineErrors: { [lineId]: "Escribe cajas completas." },
    });
    expect(
      await back(actor, receiptId, [{ receiptLineId: lineId, quantity: "1" }]),
    ).toMatchObject({ ok: true });
    expect(
      await back(actor, receiptId, [{ receiptLineId: lineId, quantity: "1" }]),
    ).toMatchObject({
      ok: false,
      lineErrors: {
        [lineId]: "Ya se devolvió todo lo que llegó de este producto.",
      },
    });
    expect(
      (
        await getOrderReceipts(
          actor,
          (
            await db.purchaseReceipt.findUniqueOrThrow({
              where: { id: receiptId },
            })
          ).orderId,
        )
      )?.canReturn,
    ).toBe(false);

    // Nothing written, no reason, a line of another receipt.
    expect(
      await back(actor, receiptId, [{ receiptLineId: lineId, quantity: "" }]),
    ).toMatchObject({
      ok: false,
      formError: "Escribe cuánto devuelves de al menos un producto.",
    });
    expect(
      await back(
        actor,
        receiptId,
        [{ receiptLineId: lineId, quantity: "1" }],
        " ",
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        reason: "Escribe por qué se devuelve (al menos 3 letras).",
      },
    });
    expect(
      await back(actor, receiptId, [{ receiptLineId: newId(), quantity: "1" }]),
    ).toMatchObject({
      ok: false,
      formError: /no corresponde a esta recepción/,
    });
    expect(await stockIn(actor, clavo)).toBe("0");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("never leaves stock below zero: what already left cannot go back", async () => {
    const actor = await company();
    const productId = await product(actor);
    const { receiptId, receiptLines } = await received(actor, [
      { productId, quantity: "5" },
    ]);
    expect(
      await registerExit(actor, { productId, quantity: "4", reason: "Venta" }),
    ).toMatchObject({ ok: true });
    const refused = await back(actor, receiptId, [
      { receiptLineId: receiptLines[0]!.id, quantity: "3" },
    ]);
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    expect(!refused.ok && refused.lineErrors?.[receiptLines[0]!.id]).toMatch(
      /En General solo hay 1 pieza/,
    );
    expect(await db.purchaseReturn.count({ where: { receiptId } })).toBe(0);
    expect(
      await db.stockMovement.count({
        where: { organizationId: actor.organizationId, type: "RETURN" },
      }),
    ).toBe(0);
    expect(await stockIn(actor, productId)).toBe("1");
  });

  it("takes it from another location when chosen, only of the company", async () => {
    const actor = await company();
    const theirs = await company();
    const productId = await product(actor);
    const shelf = await createLocation(actor, { kind: "SHELF", name: "A-01" });
    const foreign = await createLocation(theirs, { kind: "SHELF", name: "X" });
    if (!shelf.ok || !foreign.ok) throw new Error("location setup failed");
    const { receiptId, receiptLines } = await received(
      actor,
      [{ productId, quantity: "5" }],
      shelf.locationId,
    );
    const lineId = receiptLines[0]!.id;
    expect(
      await back(actor, receiptId, [
        {
          receiptLineId: lineId,
          quantity: "1",
          locationId: foreign.locationId,
        },
      ]),
    ).toMatchObject({
      ok: false,
      lineErrors: { [lineId]: "Esa ubicación ya no existe. Elige otra." },
    });
    // From where it was received unless told otherwise.
    expect(
      await back(actor, receiptId, [{ receiptLineId: lineId, quantity: "2" }]),
    ).toMatchObject({ ok: true });
    expect(await stockIn(actor, productId, shelf.locationId)).toBe("3");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("follows the matrix; a receipt of another company is not found", async () => {
    const actor = await company();
    const productId = await product(actor);
    const { orderId, receiptId, receiptLines } = await received(actor, [
      { productId, quantity: "5" },
    ]);
    const line = [{ receiptLineId: receiptLines[0]!.id, quantity: "1" }];
    for (const role of ["warehouse", "viewer"] as const) {
      await expect(
        back(await member(actor.organizationId, role), receiptId, line),
      ).rejects.toMatchObject({ kind: "forbidden" });
    }
    const theirs = await company();
    expect(await back(theirs, receiptId, line)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    const buyer = await member(actor.organizationId, "buyer");
    expect(await back(buyer, receiptId, line)).toMatchObject({ ok: true });
    // Consulta sees the returns; Almacén does not see receipts at all.
    const viewer = await member(actor.organizationId, "viewer");
    expect(
      (await getOrderReceipts(viewer, orderId))?.receipts[0]?.returns,
    ).toHaveLength(1);
    expect(await stockIn(actor, productId)).toBe("4");
  });
});

describe("concurrent and repeated returns (CMP-12, NEG-24)", () => {
  it("five returns of 1 at once against 3 received return exactly 3", async () => {
    const actor = await company();
    const productId = await product(actor);
    const { receiptId, receiptLines } = await received(actor, [
      { productId, quantity: "3" },
    ]);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        back(actor, receiptId, [
          { receiptLineId: receiptLines[0]!.id, quantity: "1" },
        ]),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await stockIn(actor, productId)).toBe("0");
    expect(await db.purchaseReturn.count({ where: { receiptId } })).toBe(3);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("two returns at once never add up to more than received", async () => {
    const actor = await company();
    const productId = await product(actor);
    const { receiptId, receiptLines } = await received(actor, [
      { productId, quantity: "10" },
    ]);
    const results = await Promise.all(
      ["7", "6"].map((quantity) =>
        back(actor, receiptId, [
          { receiptLineId: receiptLines[0]!.id, quantity },
        ]),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(["3", "4"]).toContain(await stockIn(actor, productId));
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("the same confirmation returns once; another form with its key is refused", async () => {
    const actor = await company();
    const productId = await product(actor);
    const { receiptId, receiptLines } = await received(actor, [
      { productId, quantity: "10" },
    ]);
    const lineId = receiptLines[0]!.id;
    const idempotencyKey = key();
    const send = (who: PurchasingActor, quantity: string) =>
      back(
        who,
        receiptId,
        [{ receiptLineId: lineId, quantity }],
        "Dañado",
        idempotencyKey,
      );

    const [one, two] = await Promise.all([send(actor, "2"), send(actor, "2")]);
    expect(one.ok && two.ok).toBe(true);
    expect([one, two].filter((r) => r.ok && r.repeated)).toHaveLength(1);
    expect(await send(actor, "3")).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });
    const buyer = await member(actor.organizationId, "buyer");
    expect(await send(buyer, "2")).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });
    expect(await findReturnConfirmation(actor, idempotencyKey)).toMatchObject({
      returnId: expect.any(String),
    });
    expect(await findReturnConfirmation(buyer, idempotencyKey)).toBeNull();
    expect(await stockIn(actor, productId)).toBe("8");
  });

  it("its movement is not reversed from Inventario (NEG-22)", async () => {
    const actor = await company();
    const productId = await product(actor);
    const { receiptId, receiptLines } = await received(actor, [
      { productId, quantity: "5" },
    ]);
    const done = await back(actor, receiptId, [
      { receiptLineId: receiptLines[0]!.id, quantity: "2" },
    ]);
    if (!done.ok) throw new Error("return failed");
    const row = await db.purchaseReturn.findUniqueOrThrow({
      where: { id: done.returnId },
    });
    const reversed = await reverseMovement(actor, {
      movementId: row.movementId,
      reason: "Me equivoqué",
      idempotencyKey: key(),
    });
    expect(reversed).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await stockIn(actor, productId)).toBe("3");
  });

  it("the database refuses more than received, edits and deletions", async () => {
    const actor = await company();
    const productId = await product(actor);
    const { receiptId, receiptLines } = await received(actor, [
      { productId, quantity: "2" },
    ]);
    const done = await back(actor, receiptId, [
      { receiptLineId: receiptLines[0]!.id, quantity: "2" },
    ]);
    if (!done.ok) throw new Error("return failed");
    const line = await db.purchaseReturnLine.findFirstOrThrow({
      where: { returnId: done.returnId },
    });
    await expect(
      db.purchaseReturnLine.create({
        data: {
          ...line,
          id: newId(),
          lineNumber: 2,
          capturedQuantity: "1",
          baseQuantity: "1",
        },
      }),
    ).rejects.toThrow(/more than what was received/);
    await expect(
      db.purchaseReturnLine.update({
        where: { id: line.id },
        data: { capturedQuantity: "1", baseQuantity: "1" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.purchaseReturn.delete({ where: { id: done.returnId } }),
    ).rejects.toThrow(/immutable/);
  });
});
