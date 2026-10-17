import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { registerEntry, setMinimum } from "@/modules/inventory";
import {
  addOrderLine,
  createPurchaseOrder,
  generateSuggestedOrders,
  getPurchaseSuggestions,
  linkProductSupplier,
  receivePurchaseOrder,
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

// CMP-14: what to order from minimums, by supplier, and the drafts made
// from it — never twice for the same need.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `sugerencia.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de sugerencias de compra",
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

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

async function supplierOf(actor: PurchasingActor, name: string) {
  const created = await createSupplier(actor, { name });
  if (!created.ok) throw new Error("supplier setup failed");
  return created.supplierId;
}

/** A product with its stock and minimum. */
async function stocked(actor: PurchasingActor, stock: string, minimum: string) {
  const productId = await product(actor);
  if (stock !== "0") {
    const entry = await registerEntry(actor, { productId, quantity: stock });
    if (!entry.ok) throw new Error("entry failed");
  }
  const set = await setMinimum(actor, { productId, quantity: minimum });
  if (!set.ok) throw new Error("minimum failed");
  return productId;
}

async function link(
  actor: PurchasingActor,
  productId: string,
  supplierId: string,
  presentationId?: string,
) {
  const linked = await linkProductSupplier(actor, {
    productId,
    supplierId,
    ...(presentationId ? { presentationId } : {}),
  });
  if (!linked.ok) throw new Error(`link failed: ${JSON.stringify(linked)}`);
  return linked.linkId;
}

describe("getPurchaseSuggestions", () => {
  it("suggests what is at or below its minimum, by supplier and how it is bought", async () => {
    const actor = await company();
    const norte = await supplierOf(actor, "Ferretera del Norte");
    const bajio = await supplierOf(actor, "Aceros del Bajío");
    const boxed = await stocked(actor, "4", "20");
    const caja = await box(actor, boxed, "10");
    await link(actor, boxed, norte, caja);
    const atLine = await stocked(actor, "10", "10");
    await link(actor, atLine, norte);
    const fine = await stocked(actor, "6", "5");
    await link(actor, fine, norte);
    const orphan = await stocked(actor, "0", "5");
    // Bought from both: the last purchase decides.
    const both = await stocked(actor, "0", "30");
    await link(actor, both, norte);
    const lastBought = await link(actor, both, bajio);
    await db.productSupplier.update({
      where: { id: lastBought },
      data: { lastCost: "8", lastCostAt: new Date() },
    });

    const view = await getPurchaseSuggestions(actor);
    expect(
      view.groups.map((group) => [
        group.supplierName,
        group.items.map((item) => [item.productId, item.quantityText]),
      ]),
    ).toEqual([
      ["Aceros del Bajío", [[both, "30 piezas"]]],
      [
        "Ferretera del Norte",
        [
          [boxed, "2 cajas (20 piezas)"],
          // At the minimum is low: at least one more.
          [atLine, "1 pieza"],
        ],
      ],
      [null, [[orphan, "5 piezas"]]],
    ]);
    expect(view.groups[1]?.items[0]).toMatchObject({
      stockText: "4 piezas",
      minimumText: "20 piezas",
      incomingText: null,
    });
    expect(JSON.stringify(view)).not.toContain(fine);
    expect(view.covered).toEqual([]);
  });

  it("counts what is on its way: drafts, sent orders and what is left of partial ones", async () => {
    const actor = await company();
    const norte = await supplierOf(actor, "Ferretera del Norte");
    const covered = await stocked(actor, "0", "10");
    const partly = await stocked(actor, "0", "20");
    await link(actor, covered, norte);
    await link(actor, partly, norte);
    const draft = await createPurchaseOrder(actor, { supplierId: norte });
    if (!draft.ok) throw new Error("order setup failed");
    await addOrderLine(actor, draft.orderId, {
      productId: covered,
      capture: "base",
      quantity: "10",
    });
    const sent = await createPurchaseOrder(actor, { supplierId: norte });
    if (!sent.ok) throw new Error("order setup failed");
    await addOrderLine(actor, sent.orderId, {
      productId: partly,
      capture: "base",
      quantity: "12",
    });
    await submitPurchaseOrder(actor, sent.orderId);
    const [line] = await db.purchaseOrderLine.findMany({
      where: { orderId: sent.orderId },
    });
    // 5 of 12 arrived: 5 in stock, 7 on their way, 8 still missing.
    await receivePurchaseOrder(actor, sent.orderId, {
      idempotencyKey: key(),
      lines: [{ orderLineId: line!.id, quantity: "5" }],
    });

    const view = await getPurchaseSuggestions(actor);
    expect(view.covered).toEqual([
      expect.objectContaining({
        productId: covered,
        incomingText: "10 piezas",
      }),
    ]);
    expect(view.groups[0]?.items).toEqual([
      expect.objectContaining({
        productId: partly,
        stockText: "5 piezas",
        incomingText: "7 piezas",
        quantityText: "8 piezas",
      }),
    ]);
  });

  it("follows the matrix", async () => {
    const actor = await company();
    await expect(
      getPurchaseSuggestions(await member(actor.organizationId, "warehouse")),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(
      await getPurchaseSuggestions(
        await member(actor.organizationId, "viewer"),
      ),
    ).toEqual({ groups: [], covered: [] });
  });
});

describe("generateSuggestedOrders", () => {
  it("makes one draft per supplier with the suggested lines and last costs", async () => {
    const actor = await company();
    const norte = await supplierOf(actor, "Ferretera del Norte");
    const bajio = await supplierOf(actor, "Aceros del Bajío");
    const boxed = await stocked(actor, "4", "20");
    const caja = await box(actor, boxed, "10");
    const boxedLink = await link(actor, boxed, norte, caja);
    const version = await db.presentationVersion.findFirstOrThrow({
      where: { presentationId: caja },
    });
    await db.productSupplier.update({
      where: { id: boxedLink },
      data: {
        lastCost: "95.5",
        lastCostAt: new Date(),
        lastCostPresentationId: caja,
        lastCostPresentationVersionId: version.id,
      },
    });
    const loose = await stocked(actor, "0", "3");
    await link(actor, loose, norte);
    const steel = await stocked(actor, "1", "2");
    await link(actor, steel, bajio);
    const orphan = await stocked(actor, "0", "5");

    const result = await generateSuggestedOrders(actor, {
      productIds: [boxed, loose, steel, orphan],
    });
    expect(result).toMatchObject({
      ok: true,
      orders: [
        { numberText: "OC-0001", supplierName: "Aceros del Bajío", lines: 1 },
        {
          numberText: "OC-0002",
          supplierName: "Ferretera del Norte",
          lines: 2,
        },
      ],
      summary: expect.stringContaining("Se crearon 2 borradores"),
    });
    if (!result.ok) return;
    const order = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: result.orders[1]!.orderId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(order).toMatchObject({
      status: "DRAFT",
      contactId: norte,
      notes: "Sugerida desde mínimos.",
      createdByUserId: actor.userId,
    });
    expect(
      order.lines.map((line) => [
        line.productId,
        line.presentationId,
        line.capturedQuantity.toString(),
        line.baseQuantity.toString(),
        line.unitCost?.toString() ?? null,
      ]),
    ).toEqual([
      [boxed, caja, "2", "20", "95.5"],
      [loose, null, "3", "3", null],
    ]);
    expect(
      await db.auditEvent.count({
        where: {
          action: "purchase_order.created",
          organizationId: actor.organizationId,
        },
      }),
    ).toBe(2);

    // Now it is on its way: nothing more to order; the orphan stays.
    const again = await generateSuggestedOrders(actor, {
      productIds: [boxed, loose, steel, orphan],
    });
    expect(again).toMatchObject({ ok: false, reason: "invalid" });
    const view = await getPurchaseSuggestions(actor);
    expect(view.groups.map((group) => group.supplierName)).toEqual([null]);
    expect(view.covered).toHaveLength(3);
  });

  it("two generations at once order once", async () => {
    const actor = await company();
    const norte = await supplierOf(actor, "Ferretera del Norte");
    const ids = [];
    for (let n = 0; n < 3; n++) {
      const productId = await stocked(actor, "0", "4");
      await link(actor, productId, norte);
      ids.push(productId);
    }
    const results = await Promise.all([
      generateSuggestedOrders(actor, { productIds: ids }),
      generateSuggestedOrders(actor, { productIds: [...ids].reverse() }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await db.purchaseOrder.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(1);
    expect(
      await db.purchaseOrderLine.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(3);
  });

  it("follows the matrix; products of another company are not ordered", async () => {
    const actor = await company();
    const norte = await supplierOf(actor, "Ferretera del Norte");
    const productId = await stocked(actor, "0", "4");
    await link(actor, productId, norte);
    await expect(
      generateSuggestedOrders(await member(actor.organizationId, "viewer"), {
        productIds: [productId],
      }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    const theirs = await company();
    expect(
      await generateSuggestedOrders(theirs, { productIds: [productId] }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      await generateSuggestedOrders(actor, { productIds: [] }),
    ).toMatchObject({ ok: false, error: "Elige qué productos pedir." });
    const buyer = await member(actor.organizationId, "buyer");
    expect(
      await generateSuggestedOrders(buyer, {
        productIds: [productId, newId()],
      }),
    ).toMatchObject({ ok: true, orders: [{ lines: 1 }] });
  });
});
