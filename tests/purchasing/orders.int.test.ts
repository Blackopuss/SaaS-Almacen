import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  addOrderLine,
  createPurchaseOrder,
  formatOrderNumber,
  getPurchaseOrder,
  linkProductSupplier,
  listPurchaseOrders,
  removeOrderLine,
  updateOrderLine,
  updatePurchaseOrder,
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
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-04: purchase orders — the draft and its lines. A line keeps the
// presentation and the version of its content; the conversion is visible.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `ordenes.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(
  modules: string[] = ["inventory", "purchasing"],
): Promise<PurchasingActor> {
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
      modules,
      validUntil: null,
      reason: "Prueba de órdenes de compra",
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

async function product(actor: PurchasingActor, sku: string, unit = "piece") {
  const created = await createProduct(actor, {
    sku,
    name: `Producto ${sku}`,
    unit,
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

async function supplier(actor: PurchasingActor, name = "Ferretera del Norte") {
  const created = await createSupplier(actor, { name });
  if (!created.ok) throw new Error("supplier setup failed");
  return created.supplierId;
}

async function order(actor: PurchasingActor, supplierId?: string) {
  const created = await createPurchaseOrder(actor, {
    supplierId: supplierId ?? (await supplier(actor)),
  });
  if (!created.ok) throw new Error("order setup failed");
  return created.orderId;
}

async function line(
  actor: PurchasingActor,
  orderId: string,
  input: Parameters<typeof addOrderLine>[2],
) {
  const added = await addOrderLine(actor, orderId, input);
  if (!added.ok) throw new Error(`line not added: ${JSON.stringify(added)}`);
  return added.lineId;
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("createPurchaseOrder", () => {
  it("starts a numbered draft for a supplier of the company", async () => {
    const actor = await company();
    const norte = await supplier(actor);
    const first = await createPurchaseOrder(actor, {
      supplierId: norte,
      expectedOn: "2026-10-20",
      notes: "  Entregar por la mañana.  ",
    });
    expect(first).toMatchObject({ ok: true, number: 1 });
    if (!first.ok) throw new Error("expected");
    expect(await getPurchaseOrder(actor, first.orderId)).toMatchObject({
      number: 1,
      numberText: "OC-0001",
      status: "DRAFT",
      statusLabel: "Borrador",
      editable: true,
      supplierId: norte,
      supplierName: "Ferretera del Norte",
      expectedOn: "2026-10-20",
      notes: "Entregar por la mañana.",
      lines: [],
      costsVisible: true,
      totalText: null,
      linesWithoutCost: 0,
    });
    expect(
      await createPurchaseOrder(actor, { supplierId: norte }),
    ).toMatchObject({ ok: true, number: 2 });
    // Each company counts its own.
    const theirs = await company();
    expect(
      await createPurchaseOrder(theirs, { supplierId: await supplier(theirs) }),
    ).toMatchObject({ ok: true, number: 1 });
    expect(formatOrderNumber(12345)).toBe("OC-12345");
    expect(
      await db.auditEvent.findFirst({
        where: { action: "purchase_order.created", targetId: first.orderId },
      }),
    ).toMatchObject({
      actorUserId: actor.userId,
      metadata: { orden: "OC-0001", proveedor: "Ferretera del Norte" },
    });
  });

  it("orders started at the same moment get different numbers", async () => {
    const actor = await company();
    const norte = await supplier(actor);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createPurchaseOrder(actor, { supplierId: norte }),
      ),
    );
    expect(
      results.map((result) => (result.ok ? result.number : 0)).sort(),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("needs a supplier of the company that is in use, and a real day", async () => {
    const actor = await company();
    const theirs = await company();
    const norte = await supplier(actor);
    const gone = await supplier(actor, "Ya no surte");
    await db.contact.update({
      where: { id: gone },
      data: { archivedAt: new Date() },
    });
    const customer = await db.contact.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: "Solo cliente",
        isCustomer: true,
        createdByUserId: actor.userId,
      },
    });
    for (const supplierId of [
      "",
      newId(),
      customer.id,
      await supplier(theirs, "Ajeno"),
    ]) {
      expect(await createPurchaseOrder(actor, { supplierId })).toMatchObject({
        ok: false,
        reason: "not_found",
        fieldErrors: { supplierId: "Elige un proveedor de la lista." },
      });
    }
    expect(
      await createPurchaseOrder(actor, { supplierId: gone }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: { supplierId: expect.stringContaining("archivado") },
    });
    for (const expectedOn of ["31/10/2026", "2026-02-30", "mañana"]) {
      expect(
        await createPurchaseOrder(actor, { supplierId: norte, expectedOn }),
      ).toMatchObject({
        reason: "invalid",
        fieldErrors: { expectedOn: expect.any(String) },
      });
    }
    expect(
      await createPurchaseOrder(actor, {
        supplierId: norte,
        notes: "x".repeat(501),
      }),
    ).toMatchObject({ fieldErrors: { notes: expect.any(String) } });
    expect(
      await db.purchaseOrder.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(0);
  });
});

describe("lines of a draft", () => {
  it("keep what was asked, the presentation with its version, and the result", async () => {
    const actor = await company();
    const norte = await supplier(actor);
    const tornillo = await product(actor, "TOR-1");
    const caja = await box(actor, tornillo);
    const cable = await product(actor, "CAB-2", "m");
    await linkProductSupplier(actor, {
      productId: tornillo,
      supplierId: norte,
      supplierSku: "FN-88213",
    });
    const orderId = await order(actor, norte);

    const byBox = await line(actor, orderId, {
      productId: tornillo,
      capture: `p:${caja}`,
      quantity: "3",
    });
    await line(actor, orderId, {
      productId: cable,
      capture: "base",
      quantity: "12.5",
    });

    const detail = await getPurchaseOrder(actor, orderId);
    expect(detail!.lines).toMatchObject([
      {
        id: byBox,
        lineNumber: 1,
        sku: "TOR-1",
        productName: "Producto TOR-1",
        // The code this supplier knows it by, at that moment.
        supplierSku: "FN-88213",
        capture: `p:${caja}`,
        capturedQuantity: "3",
        quantityText: "3 cajas × 100 = 300 piezas",
        perText: "caja",
      },
      {
        lineNumber: 2,
        sku: "CAB-2",
        supplierSku: null,
        capture: "base",
        capturedQuantity: "12.5",
        quantityText: "12.5 metros",
        perText: "metro",
      },
    ]);
    const stored = await db.purchaseOrderLine.findUniqueOrThrow({
      where: { id: byBox },
      include: { presentationVersion: true },
    });
    expect({
      captured: stored.capturedQuantity.toString(),
      factor: stored.factor.toString(),
      base: stored.baseQuantity.toString(),
      version: stored.presentationVersion!.version,
      unitCode: stored.unitCode,
    }).toEqual({
      captured: "3",
      factor: "100",
      base: "300",
      version: 1,
      unitCode: "piece",
    });

    // The box changes: what was ordered stays as it was ordered; a line
    // written now uses the content of now.
    await changePresentationFactor(actor, caja, {
      factor: "120",
      reason: "Nuevo empaque",
    });
    await line(actor, orderId, {
      productId: tornillo,
      capture: `p:${caja}`,
      quantity: "1",
    });
    expect(
      (await getPurchaseOrder(actor, orderId))!.lines.map(
        (item) => item.quantityText,
      ),
    ).toEqual([
      "3 cajas × 100 = 300 piezas",
      "12.5 metros",
      "1 caja × 120 = 120 piezas",
    ]);
  });

  it("follow the rules of the product and take only its own presentations", async () => {
    const actor = await company();
    const theirs = await company();
    const tornillo = await product(actor, "TOR-1");
    const clavo = await product(actor, "CLA-2");
    const otherBox = await box(actor, clavo);
    const archived = await product(actor, "VIE-3");
    await archiveProduct(actor, archived);
    const orderId = await order(actor);
    const add = (input: Parameters<typeof addOrderLine>[2]) =>
      addOrderLine(actor, orderId, input);

    expect(
      await add({ productId: tornillo, capture: "base", quantity: "2.5" }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: { quantity: expect.any(String) },
    });
    for (const quantity of ["", "0", "-3", "abc"]) {
      expect(
        await add({ productId: tornillo, capture: "base", quantity }),
        quantity,
      ).toMatchObject({
        reason: "invalid",
        fieldErrors: { quantity: expect.any(String) },
      });
    }
    // Half a box is not asked for: the problem is of the quantity.
    const ownBox = await box(actor, tornillo);
    const half = await add({
      productId: tornillo,
      capture: `p:${ownBox}`,
      quantity: "2.5",
    });
    expect(half).toMatchObject({ ok: false, reason: "invalid" });
    expect(!half.ok && half.fieldErrors.quantity).toContain(
      "Las presentaciones se capturan completas",
    );
    // The box of another product, or something that is not a choice.
    expect(
      await add({
        productId: tornillo,
        capture: `p:${otherBox}`,
        quantity: "1",
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: { capture: expect.stringContaining("no existe") },
    });
    expect(
      await add({ productId: tornillo, capture: "x:1", quantity: "1" }),
    ).toMatchObject({ fieldErrors: { capture: expect.any(String) } });
    expect(
      await add({ productId: archived, capture: "base", quantity: "1" }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: { productId: expect.stringContaining("archivado") },
    });
    for (const productId of [newId(), await product(theirs, "AJENO")]) {
      expect(
        await add({ productId, capture: "base", quantity: "1" }),
      ).toMatchObject({
        reason: "not_found",
        fieldErrors: { productId: expect.any(String) },
      });
    }
    expect(
      await add({ productId: "", capture: "base", quantity: "1" }),
    ).toMatchObject({ fieldErrors: { productId: "Elige el producto." } });
    expect((await getPurchaseOrder(actor, orderId))!.lines).toEqual([]);
  });

  it("can be changed and removed while the order is a draft", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const caja = await box(actor, tornillo);
    const orderId = await order(actor);
    const first = await line(actor, orderId, {
      productId: tornillo,
      capture: "base",
      quantity: "50",
      unitCost: "2.5",
    });
    const second = await line(actor, orderId, {
      productId: tornillo,
      capture: `p:${caja}`,
      quantity: "1",
    });

    expect(
      await updateOrderLine(actor, first, {
        capture: `p:${caja}`,
        quantity: "2",
      }),
    ).toEqual({ ok: true });
    let detail = await getPurchaseOrder(actor, orderId);
    // The quantity changed; the cost, not sent, stayed.
    expect(detail!.lines[0]).toMatchObject({
      quantityText: "2 cajas × 100 = 200 piezas",
      unitCost: "2.5",
    });
    expect(
      await updateOrderLine(actor, first, { capture: "base", quantity: "0" }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: { quantity: expect.any(String) },
    });

    expect(await removeOrderLine(actor, second)).toEqual({ ok: true });
    expect(await removeOrderLine(actor, second)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    detail = await getPurchaseOrder(actor, orderId);
    expect(detail!.lines.map((item) => item.id)).toEqual([first]);
    // A new line never takes the number of one that is still there.
    await line(actor, orderId, {
      productId: tornillo,
      capture: "base",
      quantity: "1",
    });
    expect(
      (await getPurchaseOrder(actor, orderId))!.lines.map(
        (item) => item.lineNumber,
      ),
    ).toEqual([1, 2]);

    expect(
      await updatePurchaseOrder(actor, orderId, {
        expectedOn: "2026-11-01",
        notes: "Urge",
      }),
    ).toEqual({ ok: true });
    expect(await getPurchaseOrder(actor, orderId)).toMatchObject({
      expectedOn: "2026-11-01",
      notes: "Urge",
    });
    // Emptied fields are erased.
    await updatePurchaseOrder(actor, orderId, {});
    expect(await getPurchaseOrder(actor, orderId)).toMatchObject({
      expectedOn: null,
      notes: null,
    });
  });

  it("many lines added at once each get their own number", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const orderId = await order(actor);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        addOrderLine(actor, orderId, {
          productId: tornillo,
          capture: "base",
          quantity: String(i + 1),
        }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      (await getPurchaseOrder(actor, orderId))!.lines.map(
        (item) => item.lineNumber,
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  }, 60_000);

  it("an order that is no longer a draft is not changed", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const orderId = await order(actor);
    const lineId = await line(actor, orderId, {
      productId: tornillo,
      capture: "base",
      quantity: "5",
    });
    // The states arrive with CMP-05; this is what one of them means here.
    await db.purchaseOrder.update({
      where: { id: orderId },
      data: { status: "SENT" },
    });
    const refused = { ok: false, reason: "not_draft" };
    expect(
      await addOrderLine(actor, orderId, {
        productId: tornillo,
        capture: "base",
        quantity: "1",
      }),
    ).toMatchObject(refused);
    expect(
      await updateOrderLine(actor, lineId, { capture: "base", quantity: "9" }),
    ).toMatchObject(refused);
    expect(await removeOrderLine(actor, lineId)).toMatchObject(refused);
    expect(
      await updatePurchaseOrder(actor, orderId, { notes: "Tarde" }),
    ).toMatchObject(refused);
    expect(await getPurchaseOrder(actor, orderId)).toMatchObject({
      status: "SENT",
      statusLabel: "Enviada",
      editable: false,
      notes: null,
      lines: [{ id: lineId, capturedQuantity: "5" }],
    });
  });
});

describe("costs", () => {
  it("are exact, per captured unit, and add up to the total", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const caja = await box(actor, tornillo);
    const cable = await product(actor, "CAB-2", "m");
    const orderId = await order(actor);
    const boxes = await line(actor, orderId, {
      productId: tornillo,
      capture: `p:${caja}`,
      quantity: "3",
      unitCost: "$1,250.50",
    });
    await line(actor, orderId, {
      productId: cable,
      capture: "base",
      quantity: "12.5",
      unitCost: "18.7525",
    });
    const pending = await line(actor, orderId, {
      productId: tornillo,
      capture: "base",
      quantity: "10",
    });

    const detail = await getPurchaseOrder(actor, orderId);
    expect(
      detail!.lines.map((item) => [
        item.unitCost,
        item.unitCostText,
        item.amountText,
      ]),
    ).toEqual([
      ["1250.5", "$1,250.50 por caja", "$3,751.50"],
      ["18.7525", "$18.7525 por metro", "$234.40625"],
      [null, null, null],
    ]);
    // 3 × 1250.50 + 12.5 × 18.7525, without a cent of rounding.
    expect(detail).toMatchObject({
      totalText: "$3,985.90625",
      linesWithoutCost: 1,
    });

    for (const unitCost of ["abc", "-5", "1.23456", "12,34", "99999999999"]) {
      expect(
        await updateOrderLine(actor, pending, {
          capture: "base",
          quantity: "10",
          unitCost,
        }),
        unitCost,
      ).toMatchObject({
        reason: "invalid",
        fieldErrors: { unitCost: expect.any(String) },
      });
    }
    // Zero is a cost; an empty text erases it.
    await updateOrderLine(actor, pending, {
      capture: "base",
      quantity: "10",
      unitCost: "0",
    });
    expect((await getPurchaseOrder(actor, orderId))!.linesWithoutCost).toBe(0);
    await updateOrderLine(actor, boxes, {
      capture: `p:${caja}`,
      quantity: "3",
      unitCost: "",
    });
    expect(await getPurchaseOrder(actor, orderId)).toMatchObject({
      totalText: "$234.40625",
      linesWithoutCost: 1,
    });
  });

  it("never leave the service for who may not see them (NEG-04)", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const orderId = await order(actor);
    await line(actor, orderId, {
      productId: tornillo,
      capture: "base",
      quantity: "7",
      unitCost: "987.65",
    });
    const viewer = await member(actor.organizationId, "viewer");
    const seen = await getPurchaseOrder(viewer, orderId);
    expect(seen).toMatchObject({
      numberText: "OC-0001",
      costsVisible: false,
      lines: [{ sku: "TOR-1", quantityText: "7 piezas" }],
    });
    expect("totalText" in seen!).toBe(false);
    expect("linesWithoutCost" in seen!).toBe(false);
    for (const key of ["unitCost", "unitCostText", "amountText"]) {
      expect(key in seen!.lines[0]!, key).toBe(false);
    }
    expect(JSON.stringify(seen)).not.toMatch(/987|6913/);
    expect(JSON.stringify(await listPurchaseOrders(viewer))).not.toMatch(
      /987|6913/,
    );
    // Compras sees them.
    const buyer = await member(actor.organizationId, "buyer");
    expect(await getPurchaseOrder(buyer, orderId)).toMatchObject({
      costsVisible: true,
      totalText: "$6,913.55",
    });
    // Almacén has no way in.
    await expect(
      getPurchaseOrder(
        await member(actor.organizationId, "warehouse"),
        orderId,
      ),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});

describe("listPurchaseOrders", () => {
  it("lists the newest first and can show one state", async () => {
    const actor = await company();
    const norte = await supplier(actor);
    const sur = await supplier(actor, "Ferretera del Sur");
    const first = await order(actor, norte);
    const second = await order(actor, sur);
    const third = await order(actor, norte);
    await line(actor, second, {
      productId: await product(actor, "TOR-1"),
      capture: "base",
      quantity: "1",
    });
    await db.purchaseOrder.update({
      where: { id: first },
      data: { status: "SENT" },
    });

    const all = await listPurchaseOrders(actor);
    expect(
      all.items.map((item) => [
        item.numberText,
        item.supplierName,
        item.statusLabel,
        item.lines,
      ]),
    ).toEqual([
      ["OC-0003", "Ferretera del Norte", "Borrador", 0],
      ["OC-0002", "Ferretera del Sur", "Borrador", 1],
      ["OC-0001", "Ferretera del Norte", "Enviada", 0],
    ]);
    expect(all).toMatchObject({
      total: 3,
      page: 1,
      pageCount: 1,
      status: null,
    });
    expect(all.items[0]!.id).toBe(third);

    const drafts = await listPurchaseOrders(actor, { status: "DRAFT" });
    expect(drafts.items.map((item) => item.numberText)).toEqual([
      "OC-0003",
      "OC-0002",
    ]);
    expect(drafts.status).toBe("DRAFT");
    // An unknown state is ignored; a page past the end is the last one.
    expect(
      (await listPurchaseOrders(actor, { status: "INVENTADO", page: 99 }))
        .items,
    ).toHaveLength(3);
  });
});

describe("who may, and in which company", () => {
  it("reaches only orders and lines of the company", async () => {
    const ours = await company();
    const theirs = await company();
    const foreignOrder = await order(theirs);
    const foreignLine = await line(theirs, foreignOrder, {
      productId: await product(theirs, "X-1"),
      capture: "base",
      quantity: "4",
    });
    const mine = await product(ours, "TOR-1");

    expect(await getPurchaseOrder(ours, foreignOrder)).toBeNull();
    expect(
      await addOrderLine(ours, foreignOrder, {
        productId: mine,
        capture: "base",
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await updatePurchaseOrder(ours, foreignOrder, { notes: "Colado" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await updateOrderLine(ours, foreignLine, {
        capture: "base",
        quantity: "9",
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await removeOrderLine(ours, foreignLine)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect((await listPurchaseOrders(ours)).items).toEqual([]);
    expect(await getPurchaseOrder(theirs, foreignOrder)).toMatchObject({
      notes: null,
      lines: [{ id: foreignLine, capturedQuantity: "4" }],
    });
  });

  it("follows the matrix, and needs the Compras module", async () => {
    const actor = await company();
    const norte = await supplier(actor);
    const tornillo = await product(actor, "TOR-1");
    const orderId = await order(actor, norte);
    const lineId = await line(actor, orderId, {
      productId: tornillo,
      capture: "base",
      quantity: "1",
    });
    const can = async (person: PurchasingActor) => ({
      read: await listPurchaseOrders(person).then(
        () => true,
        () => false,
      ),
      create: await createPurchaseOrder(person, { supplierId: norte }).then(
        (result) => result.ok,
        () => false,
      ),
      update: await updateOrderLine(person, lineId, {
        capture: "base",
        quantity: "2",
      }).then(
        (result) => result.ok,
        () => false,
      ),
      cost: await updateOrderLine(person, lineId, {
        capture: "base",
        quantity: "2",
        unitCost: "10",
      }).then(
        (result) => result.ok,
        () => false,
      ),
    });
    const all = { read: true, create: true, update: true, cost: true };
    expect(await can(actor)).toEqual(all);
    expect(
      await can(await member(actor.organizationId, "administrator")),
    ).toEqual(all);
    expect(await can(await member(actor.organizationId, "buyer"))).toEqual(all);
    expect(await can(await member(actor.organizationId, "viewer"))).toEqual({
      read: true,
      create: false,
      update: false,
      cost: false,
    });
    expect(await can(await member(actor.organizationId, "warehouse"))).toEqual({
      read: false,
      create: false,
      update: false,
      cost: false,
    });
    const without = await company(["inventory"]);
    await expect(listPurchaseOrders(without)).rejects.toMatchObject({
      kind: "forbidden",
    });
  });
});
