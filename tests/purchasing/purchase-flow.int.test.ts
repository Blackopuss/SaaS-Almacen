import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  listMovements,
  reconcileStock,
  registerExit,
  registerInitialBalance,
  setMinimum,
} from "@/modules/inventory";
import {
  addOrderLine,
  closePurchaseOrder,
  createPurchaseOrder,
  getOrderReceipts,
  getPendingReport,
  getPurchaseSuggestions,
  getPurchasesBySupplier,
  linkProductSupplier,
  receivePurchaseOrder,
  returnToSupplier,
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
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-18: Compras and Inventario end to end. One order is bought,
// received in two parts and two places (the box changes in between),
// partly returned and closed with its shortage, with a sale in the middle;
// every balance is checked against the arithmetic of the day, the history
// reconciles, and costs, reports and suggestions agree.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `flujocompras.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de compras de extremo a extremo",
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

async function box(actor: PurchasingActor, productId: string, factor = "100") {
  const created = await createPresentation(actor, productId, {
    name: "Caja",
    factor,
  });
  if (!created.ok) throw new Error("presentation setup failed");
  return created.presentationId;
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

const ok = <T extends { ok: boolean }>(result: T) => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
};

describe("buying with Compras and Inventario (CMP-18)", () => {
  it("buy, receive in parts, return, close and reconcile to the exact unit", async () => {
    const actor = await company();
    const buyer = await member(actor.organizationId, "buyer");
    const clavo = ok(
      await createProduct(actor, { sku: "CLA-2", name: "Clavo 2 pulgadas" }),
    ).productId;
    const tornillo = ok(
      await createProduct(actor, { sku: "TOR-1", name: "Tornillo 1/4" }),
    ).productId;
    const caja = await box(actor, clavo, "100");
    const shelf = ok(
      await createLocation(actor, { kind: "SHELF", name: "A-01" }),
    ).locationId;
    const general = (
      await db.location.findFirstOrThrow({
        where: { organizationId: actor.organizationId, isDefault: true },
      })
    ).id;
    ok(
      await registerInitialBalance(actor, { productId: clavo, quantity: "50" }),
    );

    // Compras orders it: 5 boxes of nails at $250 and 200 screws at $1.50.
    const supplierId = ok(
      await createSupplier(buyer, { name: "Ferretera del Norte" }),
    ).supplierId;
    ok(
      await linkProductSupplier(buyer, {
        productId: clavo,
        supplierId,
        presentationId: caja,
      }),
    );
    const orderId = ok(
      await createPurchaseOrder(buyer, { supplierId }),
    ).orderId;
    ok(
      await addOrderLine(buyer, orderId, {
        productId: clavo,
        capture: `p:${caja}`,
        quantity: "5",
        unitCost: "250",
      }),
    );
    ok(
      await addOrderLine(buyer, orderId, {
        productId: tornillo,
        capture: "base",
        quantity: "200",
        unitCost: "1.5",
      }),
    );
    ok(await submitPurchaseOrder(buyer, orderId));
    const [nailLine, screwLine] = await db.purchaseOrderLine.findMany({
      where: { orderId },
      orderBy: { lineNumber: "asc" },
    });

    // First part: 2 boxes to A-01 and 120 screws to General.
    const first = ok(
      await receivePurchaseOrder(buyer, orderId, {
        idempotencyKey: newId(),
        lines: [
          { orderLineId: nailLine!.id, quantity: "2", locationId: shelf },
          { orderLineId: screwLine!.id, quantity: "120" },
        ],
      }),
    );
    expect(first.status).toBe("PARTIAL");

    // The supplier's box now holds 120: the second part enters with it.
    ok(
      await changePresentationFactor(actor, caja, {
        factor: "120",
        reason: "Caja nueva del proveedor",
      }),
    );
    const second = ok(
      await receivePurchaseOrder(buyer, orderId, {
        idempotencyKey: newId(),
        lines: [{ orderLineId: nailLine!.id, quantity: "2" }],
      }),
    );
    expect(second.status).toBe("PARTIAL");

    // A sale from General in the middle.
    ok(
      await registerExit(actor, {
        productId: clavo,
        quantity: "30",
        reason: "Venta de mostrador",
      }),
    );

    // One box of the second part came damaged (it entered as 120), and 20
    // screws of the first part were the wrong size.
    const receipts = await db.purchaseReceipt.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    ok(
      await returnToSupplier(buyer, receipts[1]!.id, {
        reason: "Caja dañada",
        idempotencyKey: newId(),
        lines: [{ receiptLineId: receipts[1]!.lines[0]!.id, quantity: "1" }],
      }),
    );
    ok(
      await returnToSupplier(buyer, receipts[0]!.id, {
        reason: "Medida equivocada",
        idempotencyKey: newId(),
        lines: [{ receiptLineId: receipts[0]!.lines[1]!.id, quantity: "20" }],
      }),
    );

    // The rest will not come: closed with its shortage.
    const closed = ok(
      await closePurchaseOrder(buyer, orderId, {
        reason: "El proveedor ya no surte",
      }),
    );
    expect(closed.shortageText).toBe(
      "1 caja de Clavo 2 pulgadas y 80 piezas de Tornillo 1/4",
    );

    // Exact balances: 50 + 200 + 240 − 30 − 120 nails; 120 − 20 screws.
    expect(await getStockByLocation(actor, clavo)).toEqual({
      [shelf]: "200",
      [general]: "140",
    });
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [general]: "100",
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
    const history = await listMovements(actor, {});
    expect(history.items.map((movement) => movement.type).sort()).toEqual(
      ["EXIT", "INITIAL", "RECEIPT", "RECEIPT", "RETURN", "RETURN"].sort(),
    );

    // What the order shows: received, returned and the shortage.
    const view = await getOrderReceipts(buyer, orderId);
    expect(view?.canReceive).toBe(false);
    expect(
      view?.lines.map((line) => [line.receivedText, line.pendingText]),
    ).toEqual([
      ["4 cajas", "1 caja"],
      ["120 piezas", "80 piezas"],
    ]);
    expect(
      view?.receipts.flatMap((receipt) =>
        receipt.lines.map((line) => [line.quantityText, line.returnedText]),
      ),
    ).toEqual(
      expect.arrayContaining([
        ["2 cajas × 120 = 240 piezas", "1 caja"],
        ["2 cajas × 100 = 200 piezas", null],
        ["120 piezas", "20 piezas"],
      ]),
    );

    // Last cost, reports and suggestion agree with what happened.
    const nailCost = await db.productSupplier.findFirstOrThrow({
      where: { productId: clavo, contactId: supplierId },
    });
    expect(nailCost.lastCost?.toString()).toBe("250");
    expect((await getPendingReport(buyer)).rows).toEqual([]);
    const bySupplier = ok(await getPurchasesBySupplier(buyer));
    expect(bySupplier.rows).toEqual([
      expect.objectContaining({
        supplierName: "Ferretera del Norte",
        receipts: 2,
        orders: 1,
        products: 2,
        returns: 2,
        receivedAmountText: "$1,180.00",
        returnedAmountText: "$280.00",
        netAmountText: "$900.00",
      }),
    ]);
    ok(await setMinimum(actor, { productId: tornillo, quantity: "150" }));
    const suggestion = await getPurchaseSuggestions(buyer);
    expect(suggestion.groups).toEqual([
      expect.objectContaining({
        supplierName: "Ferretera del Norte",
        items: [
          expect.objectContaining({
            productId: tornillo,
            quantityText: "50 piezas",
          }),
        ],
      }),
    ]);

    // A product with stock is not archived; the audit tells the story.
    expect(await archiveProduct(actor, clavo)).toMatchObject({
      ok: false,
      reason: "has_stock",
    });
    const actions = (
      await db.auditEvent.findMany({
        where: { organizationId: actor.organizationId, targetId: orderId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { action: true },
      })
    ).map((event) => event.action);
    expect(actions).toEqual([
      "purchase_order.created",
      "purchase_order.sent",
      "purchase_order.received",
      "purchase_order.received",
      "purchase_order.returned",
      "purchase_order.returned",
      "purchase_order.closed",
    ]);
  });
});
