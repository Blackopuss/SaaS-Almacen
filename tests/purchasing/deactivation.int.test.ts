import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { getStockByLocation } from "@/modules/inventory";
import {
  addOrderLine,
  buildPurchaseReport,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  getOrderReceipts,
  getPendingReport,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePurchaseOrder,
  submitPurchaseOrder,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleOpenWork, moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { createProduct } from "@/platform/catalog";
import { createSupplier } from "@/platform/contacts";
import {
  getFreshEntitlements,
  invalidateEntitlements,
} from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-17: taking Compras away from a company warns about its open work;
// its orders stay as they were, readable, and go on if it comes back.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `desactivar.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de quitar Compras",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
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

const plan = (modules: string[], reason = "Cambio de plan") => ({
  productLimit: 30,
  users: 10,
  modules,
  validUntil: null,
  reason,
});

describe("removing Compras (CMP-17)", () => {
  it("warns about open orders first; removed anyway, its history stays read-only", async () => {
    const actor = await company();
    const productId = await product(actor);
    const sent = await sentOrder(actor, [{ productId, quantity: "5" }]);
    const partial = await sentOrder(actor, [{ productId, quantity: "4" }]);
    const [line] = await db.purchaseOrderLine.findMany({
      where: { orderId: partial },
    });
    await receivePurchaseOrder(actor, partial, {
      idempotencyKey: key(),
      lines: [{ orderLineId: line!.id, quantity: "1" }],
    });
    const supplier = await createSupplier(actor, { name: "Otro" });
    if (!supplier.ok) throw new Error("supplier setup failed");
    await createPurchaseOrder(actor, { supplierId: supplier.supplierId });

    const warned = await provisionCompany(
      moduleRegistry,
      staff,
      actor.organizationId,
      plan(["inventory"]),
      { openWork: moduleOpenWork },
    );
    expect(warned).toMatchObject({
      ok: false,
      formError: expect.stringContaining("Compras tiene trabajo sin terminar"),
      openWork: [
        {
          module: "Compras",
          lines: [
            "1 orden enviada espera mercancía (OC-0001): ya no se podrá recibir por Compras.",
            "1 orden recibida en parte (OC-0002): lo que falta ya no se podrá recibir ni cerrar.",
            "1 borrador (OC-0003) sin confirmar.",
          ],
        },
      ],
    });
    // Nothing changed yet.
    expect(
      (await getFreshEntitlements(actor.organizationId)).moduleState(
        "purchasing",
      ),
    ).toBe("active");

    expect(
      await provisionCompany(
        moduleRegistry,
        staff,
        actor.organizationId,
        plan(["inventory"], "El cliente ya no compra por aquí"),
        { openWork: moduleOpenWork, acceptOpenWork: true },
      ),
    ).toEqual({ ok: true });
    invalidateEntitlements();
    expect(
      (await getFreshEntitlements(actor.organizationId)).moduleState(
        "purchasing",
      ),
    ).toBe("read_only");

    // The history reads and exports; nothing new is written.
    expect(await getPurchaseOrder(actor, sent)).toMatchObject({
      status: "SENT",
    });
    expect((await listPurchaseOrders(actor)).total).toBe(3);
    expect((await getOrderReceipts(actor, partial))?.receipts).toHaveLength(1);
    expect((await getPendingReport(actor)).rows).toHaveLength(2);
    expect(
      await buildPurchaseReport(actor, { kind: "pendientes", format: "csv" }),
    ).toMatchObject({ ok: true });
    for (const attempt of [
      () => receivePurchaseOrder(actor, sent, { idempotencyKey: key() }),
      () => closePurchaseOrder(actor, partial, { reason: "Ya no" }),
      () => createPurchaseOrder(actor, { supplierId: supplier.supplierId }),
      () => cancelPurchaseOrder(actor, sent, { reason: "Ya no" }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: "module_read_only",
      });
    }
    // The orders are as they were, and go on when the module comes back.
    expect(
      await db.purchaseOrder.count({
        where: { organizationId: actor.organizationId, status: "CANCELLED" },
      }),
    ).toBe(0);
    expect(
      await provisionCompany(
        moduleRegistry,
        staff,
        actor.organizationId,
        plan(["inventory", "purchasing"], "Regresa a Compras"),
        { openWork: moduleOpenWork },
      ),
    ).toEqual({ ok: true });
    invalidateEntitlements();
    expect(
      await receivePurchaseOrder(actor, sent, { idempotencyKey: key() }),
    ).toMatchObject({ ok: true, status: "RECEIVED" });
    expect(await stockIn(actor, productId)).toBe("6");
  });

  it("without open work there is nothing to warn about", async () => {
    const actor = await company();
    expect(await moduleOpenWork("purchasing", actor.organizationId)).toEqual(
      [],
    );
    expect(await moduleOpenWork("inventory", actor.organizationId)).toEqual([]);
    expect(
      await provisionCompany(
        moduleRegistry,
        staff,
        actor.organizationId,
        plan(["inventory"]),
        { openWork: moduleOpenWork },
      ),
    ).toEqual({ ok: true });
  });

  it("keeping the module does not ask about its work", async () => {
    const actor = await company();
    const productId = await product(actor);
    await sentOrder(actor, [{ productId, quantity: "5" }]);
    expect(
      await provisionCompany(
        moduleRegistry,
        staff,
        actor.organizationId,
        { ...plan(["inventory", "purchasing"]), users: 12 },
        { openWork: moduleOpenWork },
      ),
    ).toEqual({ ok: true });
  });
});
