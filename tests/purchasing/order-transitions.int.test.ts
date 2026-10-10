import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  addOrderLine,
  advanceOrderOnReceipt,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  removeOrderLine,
  submitPurchaseOrder,
  updateOrderLine,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { archiveProduct, createProduct } from "@/platform/catalog";
import { createSupplier } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// CMP-05: states of the order. Draft → sent → partial → received, or
// cancelled; invalid transitions are refused — by the service and, as a
// last defense, by the database.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `estadosoc.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de estados de la orden",
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
/** A draft with `lines` products, ready to be confirmed. */
async function draft(actor: PurchasingActor, lines = 1) {
  const supplier = await createSupplier(actor, {
    name: `Proveedor ${newId().slice(-6)}`,
  });
  if (!supplier.ok) throw new Error("supplier setup failed");
  const order = await createPurchaseOrder(actor, {
    supplierId: supplier.supplierId,
  });
  if (!order.ok) throw new Error("order setup failed");
  const productIds: string[] = [];
  const lineIds: string[] = [];
  for (let i = 0; i < lines; i++) {
    const product = await createProduct(actor, {
      sku: `P-${++skus}`,
      name: `Producto ${skus}`,
    });
    if (!product.ok) throw new Error("product setup failed");
    const line = await addOrderLine(actor, order.orderId, {
      productId: product.productId,
      capture: "base",
      quantity: "5",
    });
    if (!line.ok) throw new Error("line setup failed");
    productIds.push(product.productId);
    lineIds.push(line.lineId);
  }
  return { orderId: order.orderId, productIds, lineIds };
}

/** What a receipt does to the order, as CMP-07/08 will. */
const received = (
  actor: PurchasingActor,
  orderId: string,
  to: "PARTIAL" | "RECEIVED",
) =>
  forOrganization(actor.organizationId).$transaction((tx) =>
    advanceOrderOnReceipt(tx, orderId, to),
  );

const statusOf = async (orderId: string) =>
  (await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).status;

const audits = (orderId: string, action: string) =>
  db.auditEvent.findMany({ where: { action, targetId: orderId } });

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("submitPurchaseOrder", () => {
  it("confirms a draft as sent; from then on its lines do not change", async () => {
    const actor = await company();
    const { orderId, lineIds, productIds } = await draft(actor, 2);
    expect(await getPurchaseOrder(actor, orderId)).toMatchObject({
      status: "DRAFT",
      editable: true,
      canSubmit: true,
      canCancel: true,
      sentAt: null,
    });

    expect(await submitPurchaseOrder(actor, orderId)).toEqual({
      ok: true,
      status: "SENT",
    });
    const sent = await getPurchaseOrder(actor, orderId);
    expect(sent).toMatchObject({
      status: "SENT",
      statusLabel: "Enviada",
      editable: false,
      canSubmit: false,
      canCancel: true,
      cancelledAt: null,
    });
    expect(sent!.sentAt).toBeInstanceOf(Date);
    expect(
      await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } }),
    ).toMatchObject({ sentByUserId: actor.userId });
    const [event] = await audits(orderId, "purchase_order.sent");
    expect(event).toMatchObject({
      actorUserId: actor.userId,
      metadata: { orden: "OC-0001", productos: 2 },
    });

    // Confirming again confirms once.
    expect(await submitPurchaseOrder(actor, orderId)).toEqual({
      ok: true,
      status: "SENT",
      repeated: true,
    });
    expect(await audits(orderId, "purchase_order.sent")).toHaveLength(1);

    const refused = { ok: false, reason: "not_draft" };
    expect(
      await addOrderLine(actor, orderId, {
        productId: productIds[0]!,
        capture: "base",
        quantity: "1",
      }),
    ).toMatchObject(refused);
    expect(
      await updateOrderLine(actor, lineIds[0]!, {
        capture: "base",
        quantity: "9",
      }),
    ).toMatchObject(refused);
    expect(await removeOrderLine(actor, lineIds[1]!)).toMatchObject(refused);
    expect(sent!.lines).toHaveLength(2);
  });

  it("needs something to ask for, and products still in use", async () => {
    const actor = await company();
    const empty = await draft(actor, 0);
    expect(await getPurchaseOrder(actor, empty.orderId)).toMatchObject({
      canSubmit: false,
    });
    const nothing = await submitPurchaseOrder(actor, empty.orderId);
    expect(nothing).toMatchObject({ ok: false, reason: "invalid" });
    expect(!nothing.ok && nothing.formError).toContain("todavía no pide nada");

    const { orderId, productIds } = await draft(actor, 2);
    await archiveProduct(actor, productIds[1]!);
    const archived = await submitPurchaseOrder(actor, orderId);
    expect(archived).toMatchObject({ ok: false, reason: "invalid" });
    expect(!archived.ok && archived.formError).toMatch(
      /^P-\d+ está archivado\. Quítalo/,
    );
    expect(await statusOf(orderId)).toBe("DRAFT");
    expect(await statusOf(empty.orderId)).toBe("DRAFT");
  });

  it("many confirmations at once confirm once", async () => {
    const actor = await company();
    const { orderId } = await draft(actor);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => submitPurchaseOrder(actor, orderId)),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      results.filter((result) => result.ok && !result.repeated),
    ).toHaveLength(1);
    expect(await audits(orderId, "purchase_order.sent")).toHaveLength(1);
  }, 60_000);
});

describe("cancelPurchaseOrder", () => {
  it("cancels a draft or a sent order, with its reason, and keeps it as history", async () => {
    const actor = await company();
    const a = await draft(actor);
    const b = await draft(actor, 2);
    await submitPurchaseOrder(actor, b.orderId);

    for (const reason of [undefined, "", "  ", "no", "x".repeat(301)]) {
      expect(
        await cancelPurchaseOrder(actor, a.orderId, { reason }),
        String(reason).slice(0, 5),
      ).toMatchObject({
        ok: false,
        reason: "invalid",
        fieldErrors: { reason: expect.any(String) },
      });
    }
    expect(await statusOf(a.orderId)).toBe("DRAFT");

    expect(
      await cancelPurchaseOrder(actor, a.orderId, {
        reason: "  Se pidió por error.  ",
      }),
    ).toEqual({ ok: true, status: "CANCELLED" });
    expect(
      await cancelPurchaseOrder(actor, b.orderId, {
        reason: "El proveedor ya no lo maneja.",
      }),
    ).toEqual({ ok: true, status: "CANCELLED" });

    const cancelled = await getPurchaseOrder(actor, b.orderId);
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      statusLabel: "Cancelada",
      editable: false,
      canSubmit: false,
      canCancel: false,
      cancelReason: "El proveedor ya no lo maneja.",
    });
    // What it asked for, and that it had been sent, stay as they were.
    expect(cancelled!.lines).toHaveLength(2);
    expect(cancelled!.sentAt).toBeInstanceOf(Date);
    expect(cancelled!.cancelledAt).toBeInstanceOf(Date);
    const [event] = await audits(b.orderId, "purchase_order.cancelled");
    expect(event).toMatchObject({
      actorUserId: actor.userId,
      reason: "El proveedor ya no lo maneja.",
      metadata: { estabaEn: "Enviada" },
    });
    expect((await getPurchaseOrder(actor, a.orderId))!.cancelReason).toBe(
      "Se pidió por error.",
    );

    // Cancelling again cancels once and keeps the first reason.
    expect(
      await cancelPurchaseOrder(actor, b.orderId, { reason: "Otra razón" }),
    ).toEqual({ ok: true, status: "CANCELLED", repeated: true });
    expect((await getPurchaseOrder(actor, b.orderId))!.cancelReason).toBe(
      "El proveedor ya no lo maneja.",
    );
    expect(await audits(b.orderId, "purchase_order.cancelled")).toHaveLength(1);
  });

  it("confirming and cancelling at once leaves one coherent state", async () => {
    for (let round = 0; round < 4; round++) {
      const actor = await company();
      const { orderId } = await draft(actor);
      const [submitted, cancelled] = await Promise.all([
        submitPurchaseOrder(actor, orderId),
        cancelPurchaseOrder(actor, orderId, { reason: "Ya no hace falta" }),
      ]);
      // Cancelling a draft or a sent order is always allowed, so it ends
      // cancelled; whether it was sent first depends on who arrived.
      expect(cancelled).toMatchObject({ ok: true, status: "CANCELLED" });
      const row = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: orderId },
      });
      expect(row.status).toBe("CANCELLED");
      expect(row.sentAt !== null).toBe(submitted.ok);
      if (!submitted.ok) {
        expect(submitted).toMatchObject({ reason: "invalid_transition" });
      }
    }
  }, 60_000);
});

describe("invalid transitions are refused", () => {
  it("receipts move a sent order forward, and nothing moves it back", async () => {
    const actor = await company();
    const { orderId } = await draft(actor);
    // A receipt for an order that was never sent must not go through.
    await expect(received(actor, orderId, "PARTIAL")).rejects.toThrow(
      "cannot go from DRAFT to PARTIAL",
    );
    await submitPurchaseOrder(actor, orderId);

    await received(actor, orderId, "PARTIAL");
    expect(await getPurchaseOrder(actor, orderId)).toMatchObject({
      status: "PARTIAL",
      statusLabel: "Recibida en parte",
      editable: false,
      canSubmit: false,
      canCancel: false,
    });
    // Another partial receipt leaves it where it is.
    await received(actor, orderId, "PARTIAL");
    expect(await statusOf(orderId)).toBe("PARTIAL");

    // What already arrived is history: it is not cancelled nor re-sent.
    const cancel = await cancelPurchaseOrder(actor, orderId, {
      reason: "Ya no la quiero",
    });
    expect(cancel).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(!cancel.ok && cancel.formError).toContain(
      "Ya se recibió una parte de esta orden: no se cancela",
    );
    expect(await submitPurchaseOrder(actor, orderId)).toMatchObject({
      ok: false,
      reason: "invalid_transition",
    });

    await received(actor, orderId, "RECEIVED");
    expect(await statusOf(orderId)).toBe("RECEIVED");
    for (const attempt of [
      await submitPurchaseOrder(actor, orderId),
      await cancelPurchaseOrder(actor, orderId, { reason: "Tarde" }),
    ]) {
      expect(attempt).toMatchObject({
        ok: false,
        reason: "invalid_transition",
      });
      expect(!attempt.ok && attempt.formError).toContain(
        "ya se recibió completa",
      );
    }
    await expect(received(actor, orderId, "PARTIAL")).rejects.toThrow(
      "cannot go from RECEIVED to PARTIAL",
    );
    expect(await statusOf(orderId)).toBe("RECEIVED");
  });

  it("a sent order can be received whole at once; a cancelled one, never", async () => {
    const actor = await company();
    const whole = await draft(actor);
    await submitPurchaseOrder(actor, whole.orderId);
    await received(actor, whole.orderId, "RECEIVED");
    expect(await statusOf(whole.orderId)).toBe("RECEIVED");

    const gone = await draft(actor);
    await cancelPurchaseOrder(actor, gone.orderId, { reason: "Se canceló" });
    const again = await submitPurchaseOrder(actor, gone.orderId);
    expect(again).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(!again.ok && again.formError).toContain("está cancelada");
    await expect(received(actor, gone.orderId, "RECEIVED")).rejects.toThrow(
      "cannot go from CANCELLED to RECEIVED",
    );
    await expect(received(actor, newId(), "RECEIVED")).rejects.toThrow(
      "not found",
    );
  });

  it("the database refuses them too, whoever writes", async () => {
    const actor = await company();
    const { orderId, lineIds, productIds } = await draft(actor);
    const set = (data: object) =>
      db.purchaseOrder.update({ where: { id: orderId }, data });
    const now = new Date();
    const sent = { status: "SENT", sentAt: now, sentByUserId: actor.userId };

    // A draft is not received without being sent, and each state carries
    // its own data.
    await expect(set({ ...sent, status: "RECEIVED" })).rejects.toThrow(
      /invalid state transition/,
    );
    await expect(set({ status: "SENT" })).rejects.toThrow(
      /purchase_order_state_check/,
    );
    await expect(
      set({
        status: "CANCELLED",
        cancelledAt: now,
        cancelledByUserId: actor.userId,
      }),
    ).rejects.toThrow(/purchase_order_state_check/);

    await set(sent);
    // Not back to a draft; its lines are closed; supplier and number fixed.
    await expect(set({ status: "DRAFT", sentAt: null })).rejects.toThrow(
      /invalid state transition/,
    );
    await expect(
      db.purchaseOrderLine.update({
        where: { id: lineIds[0]! },
        data: { capturedQuantity: "9", baseQuantity: "9" },
      }),
    ).rejects.toThrow(/the order is not a draft/);
    await expect(
      db.purchaseOrderLine.delete({ where: { id: lineIds[0]! } }),
    ).rejects.toThrow(/the order is not a draft/);
    await expect(
      db.purchaseOrderLine.create({
        data: {
          id: newId(),
          organizationId: actor.organizationId,
          orderId,
          lineNumber: 2,
          productId: productIds[0]!,
          capturedQuantity: "1",
          factor: "1",
          baseQuantity: "1",
          unitCode: "piece",
        },
      }),
    ).rejects.toThrow(/the order is not a draft/);
    await expect(set({ number: 99 })).rejects.toThrow(
      /supplier and number cannot change/,
    );

    await set({ status: "PARTIAL" });
    await expect(
      set({
        status: "CANCELLED",
        cancelledAt: now,
        cancelledByUserId: actor.userId,
        cancelReason: "A la fuerza",
      }),
    ).rejects.toThrow(/invalid state transition/);
    await expect(set({ status: "SENT" })).rejects.toThrow(
      /invalid state transition/,
    );
    await set({ status: "RECEIVED" });
    await expect(set({ status: "PARTIAL" })).rejects.toThrow(
      /invalid state transition/,
    );
    expect(await statusOf(orderId)).toBe("RECEIVED");
  });
});

describe("who may, and in which company", () => {
  it("follows the matrix; an order of another company is not found", async () => {
    const actor = await company();
    const theirs = await company();
    const foreign = await draft(theirs);
    expect(await submitPurchaseOrder(actor, foreign.orderId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(
      await cancelPurchaseOrder(actor, foreign.orderId, { reason: "Colado" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await statusOf(foreign.orderId)).toBe("DRAFT");

    for (const role of ["viewer", "warehouse"] as const) {
      const person = await member(actor.organizationId, role);
      const { orderId } = await draft(actor);
      await expect(submitPurchaseOrder(person, orderId)).rejects.toMatchObject({
        kind: "forbidden",
      });
      await expect(
        cancelPurchaseOrder(person, orderId, { reason: "Sin permiso" }),
      ).rejects.toMatchObject({ kind: "forbidden" });
      expect(await statusOf(orderId)).toBe("DRAFT");
    }
    for (const role of ["buyer", "administrator"] as const) {
      const person = await member(actor.organizationId, role);
      const a = await draft(actor);
      const b = await draft(actor);
      expect((await submitPurchaseOrder(person, a.orderId)).ok, role).toBe(
        true,
      );
      expect(
        (await cancelPurchaseOrder(person, b.orderId, { reason: "No va" })).ok,
        role,
      ).toBe(true);
    }
  });
});
