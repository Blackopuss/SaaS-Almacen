import { afterAll, afterEach, describe, expect, it } from "vitest";

import { visibleNavItems } from "@/components";
import { newId } from "@/lib";
import * as purchasing from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import {
  can,
  isPermission,
  loadSubject,
  ROLE_PERMISSIONS,
} from "@/platform/authorization";
import { entitles, provisionCompany } from "@/platform/billing";
import { createPresentation, createProduct } from "@/platform/catalog";
import * as contacts from "@/platform/contacts";
import {
  getEntitlements,
  invalidateEntitlements,
} from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-16: without the Compras module nothing of it works — every service
// refuses, whoever calls it (the titular included) — and the menu does
// not offer it. A service added later without its guard fails here.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `guardcompras.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(modules: string[]) {
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
      reason: "Prueba del guard de Compras",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function buyerOf(organizationId: string) {
  return memberOf(organizationId, "buyer");
}

async function memberOf(
  organizationId: string,
  role: "buyer" | "viewer" | "warehouse",
) {
  const userId = await newUser();
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  await db.membershipRole.create({
    data: {
      id: newId(),
      organizationId,
      membershipId: membership.id,
      role,
    },
  });
  return { organizationId, userId };
}

/**
 * Exported functions that are not services a person calls: pure helpers,
 * and the pieces that run inside the transaction of a service that has
 * already checked its permission.
 */
const NOT_SERVICES = new Set([
  "canTransition",
  "transitionProblem",
  "isPurchaseOrderStatus",
  "isPurchaseReportKind",
  "formatOrderNumber",
  "recordLastCost",
  "advanceOrderOnReceipt",
  // Asked by the platform console (staff only) before removing the module.
  "purchasingOpenWork",
]);

const services = Object.entries(purchasing).filter(
  ([name, value]) => typeof value === "function" && !NOT_SERVICES.has(name),
) as [string, (...args: unknown[]) => Promise<unknown>][];

const supplierServices = (
  ["createSupplier", "updateSupplier", "getSupplier", "listSuppliers"] as const
).map((name) => [name, contacts[name]] as const);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("Compras without the module (CMP-16)", () => {
  it("knows every service of the module", () => {
    expect(services.map(([name]) => name).sort()).toEqual(
      [
        "addOrderLine",
        "buildOrderPdf",
        "buildPurchaseReport",
        "cancelPurchaseOrder",
        "closePurchaseOrder",
        "createPurchaseOrder",
        "findReceiptConfirmation",
        "findReturnConfirmation",
        "generateSuggestedOrders",
        "getOrderDeliveries",
        "getOrderReceipts",
        "getPendingReport",
        "getProductSupplier",
        "getPurchaseOrder",
        "getPurchaseSuggestions",
        "getPurchasesBySupplier",
        "linkProductSupplier",
        "listProductsOfSupplier",
        "listPurchaseOrders",
        "listSuppliersOfProduct",
        "receivePurchaseOrder",
        "removeOrderLine",
        "requestOrderDelivery",
        "returnToSupplier",
        "submitPurchaseOrder",
        "updateOrderLine",
        "updateProductSupplier",
        "updatePurchaseOrder",
      ].sort(),
    );
  });

  it("every service refuses, for the titular and for a buyer", async () => {
    const owner = await company(["inventory"]);
    const buyer = await buyerOf(owner.organizationId);
    for (const actor of [owner, buyer]) {
      for (const [name, service] of [...services, ...supplierServices]) {
        await expect(
          (service as (...args: unknown[]) => Promise<unknown>)(
            actor,
            newId(),
            { reason: "Prueba", productIds: [newId()] },
          ),
          name,
        ).rejects.toMatchObject({
          kind: "forbidden",
          code: "module_not_contracted",
        });
      }
    }
  });

  it("with the module, the same calls get past the guard", async () => {
    const owner = await company(["inventory", "purchasing"]);
    for (const [name, service] of services) {
      const outcome = await (
        service as (...args: unknown[]) => Promise<unknown>
      )(owner, newId(), { reason: "Prueba", productIds: [newId()] }).then(
        () => "answered",
        (error: { code?: string }) => error.code ?? "error",
      );
      expect(outcome, name).not.toBe("module_not_contracted");
      expect(outcome, name).not.toBe("permission_denied");
    }
  });

  it("the menu offers Compras only to a company that has it", async () => {
    const menuOf = async (actor: {
      organizationId: string;
      userId: string;
    }) => {
      const subject = await loadSubject(actor.organizationId, actor.userId);
      const entitlements = await getEntitlements(actor.organizationId);
      return visibleNavItems(
        (permission) =>
          isPermission(permission) &&
          can(subject, permission) &&
          entitles(entitlements, permission),
      ).map((item) => item.href);
    };
    const without = await company(["inventory"]);
    const withIt = await company(["inventory", "purchasing"]);
    expect(await menuOf(without)).not.toContain("/compras");
    expect(await menuOf(await buyerOf(without.organizationId))).not.toContain(
      "/compras",
    );
    expect(await menuOf(withIt)).toContain("/compras");
    expect(await menuOf(await buyerOf(withIt.organizationId))).toContain(
      "/compras",
    );
  });
});

describe("the buyer (CMP-16)", () => {
  it("has exactly the permissions of the matrix: Compras, and Inventario to consult", () => {
    const granted = [...ROLE_PERMISSIONS.buyer];
    expect(granted.filter((p) => p.startsWith("purchasing."))).toEqual(
      expect.arrayContaining([
        "purchasing.order.create",
        "purchasing.receipt.create",
        "purchasing.return.create",
        "purchasing.cost.read",
        "purchasing.report.export",
      ]),
    );
    // What changes stock by hand is not for the buyer (NEG-05).
    for (const permission of [
      "inventory.entry.create",
      "inventory.exit.create",
      "inventory.adjustment.create",
      "inventory.movement.reverse",
      "inventory.product.create",
      "inventory.product.archive",
    ]) {
      expect(isPermission(permission), permission).toBe(true);
      expect(granted, permission).not.toContain(permission);
    }
  });
});

describe("costs never leave Compras for who may not see them (CMP-16, NEG-04, NEG-25)", () => {
  it("no answer, report or file carries them for Consulta", async () => {
    const owner = await company(["inventory", "purchasing"]);
    const ok = <T extends { ok: boolean }>(result: T) => {
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result as Extract<T, { ok: true }>;
    };
    const product = ok(
      await createProduct(owner, { sku: "CLA-9", name: "Clavo caro" }),
    );
    const caja = ok(
      await createPresentation(owner, product.productId, {
        name: "Caja",
        factor: "10",
      }),
    );
    const supplier = ok(
      await contacts.createSupplier(owner, { name: "Proveedor caro" }),
    );
    const order = ok(
      await purchasing.createPurchaseOrder(owner, {
        supplierId: supplier.supplierId,
      }),
    );
    ok(
      await purchasing.addOrderLine(owner, order.orderId, {
        productId: product.productId,
        capture: `p:${caja.presentationId}`,
        quantity: "3",
        unitCost: "7777.77",
      }),
    );
    ok(await purchasing.submitPurchaseOrder(owner, order.orderId));
    const [line] = await db.purchaseOrderLine.findMany({
      where: { orderId: order.orderId },
    });
    ok(
      await purchasing.receivePurchaseOrder(owner, order.orderId, {
        idempotencyKey: newId(),
        lines: [{ orderLineId: line!.id, quantity: "1" }],
      }),
    );
    const link = await db.productSupplier.findFirstOrThrow({
      where: { productId: product.productId },
    });
    const cost = /7777[.]77|7,777[.]77/;

    // Who sees costs gets them (so the probe below can find them)…
    expect(
      JSON.stringify(await purchasing.getPurchaseOrder(owner, order.orderId)),
    ).toMatch(cost);
    // …Consulta, nowhere.
    const viewer = await memberOf(owner.organizationId, "viewer");
    const answers = await Promise.all([
      purchasing.getPurchaseOrder(viewer, order.orderId),
      purchasing.listPurchaseOrders(viewer),
      purchasing.getOrderReceipts(viewer, order.orderId),
      purchasing.getProductSupplier(viewer, link.id),
      purchasing.listSuppliersOfProduct(viewer, product.productId),
      purchasing.listProductsOfSupplier(viewer, supplier.supplierId),
      purchasing.getPendingReport(viewer),
      purchasing.getPurchasesBySupplier(viewer),
      purchasing.getPurchaseSuggestions(viewer),
    ]);
    for (const [index, answer] of answers.entries()) {
      expect(JSON.stringify(answer), String(index)).not.toMatch(cost);
    }
    for (const kind of ["pendientes", "proveedores"] as const) {
      const file = ok(
        await purchasing.buildPurchaseReport(viewer, { kind, format: "csv" }),
      );
      expect(file.bytes.toString("utf8"), kind).not.toMatch(cost);
    }
    // The PDF carries prices: Consulta does not download it.
    await expect(
      purchasing.buildOrderPdf(viewer, order.orderId),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});
