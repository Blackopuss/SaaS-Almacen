import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import { getSalePrices, setSalePrices } from "@/modules/sales";
import { listAuditTrail } from "@/platform/audit";
import { createPresentation, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-03 (ADR 0030): a price for the unit and, if wanted, one for each
// presentation; the margin only for who may see costs.

let skus = 0;
async function screwWithBox(actor: { organizationId: string; userId: string }) {
  const created = await createProduct(actor, {
    sku: `T-${++skus}`,
    name: `Tornillo ${skus}`,
  });
  if (!created.ok) throw new Error("product setup failed");
  const box = await createPresentation(actor, created.productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  return { productId: created.productId, boxId: box.presentationId };
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("sale prices", () => {
  it("the box has its own price; without it, content × unit", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screwWithBox(actor);
    // Cost of a screw $0.90: the margin shows for the titular.
    await registerEntry(actor, {
      productId,
      quantity: "1000",
      unitCost: "0.90",
    });

    expect(
      await setSalePrices(actor, productId, {
        unitPrice: "1.5",
        presentations: {},
      }),
    ).toEqual({ ok: true, changed: 1 });
    let prices = await getSalePrices(actor, productId);
    expect(prices?.rows).toEqual([
      {
        presentationId: null,
        label: "Pieza",
        factor: "1",
        price: "1.50",
        sellsAt: "$1.50",
        derived: false,
        margin: "$0.60 (40 %)",
      },
      {
        presentationId: boxId,
        label: "Caja = 500 piezas",
        factor: "500",
        price: null,
        sellsAt: "$750.00",
        derived: true,
        margin: "$300.00 (40 %)",
      },
    ]);

    expect(
      await setSalePrices(actor, productId, {
        unitPrice: "1.50",
        presentations: { [boxId]: "$500" },
      }),
    ).toEqual({ ok: true, changed: 1 });
    prices = await getSalePrices(actor, productId);
    expect(prices?.rows[1]).toMatchObject({
      price: "500.00",
      sellsAt: "$500.00",
      derived: false,
      margin: "$50.00 (10 %)",
    });

    // Emptying the box's price goes back to content × unit.
    await setSalePrices(actor, productId, {
      unitPrice: "1.50",
      presentations: { [boxId]: "" },
    });
    prices = await getSalePrices(actor, productId);
    expect(prices?.rows[1]).toMatchObject({ price: null, sellsAt: "$750.00" });

    const trail = await listAuditTrail(actor.organizationId, { limit: 10 });
    const changes = trail.filter(
      (entry) => entry.action === "sales.prices_changed",
    );
    expect(changes).toHaveLength(3);
    // Newest first, with names people know, never ids.
    expect(changes.map((entry) => entry.facts)).toEqual([
      ["Clave: T-1", "Cambió: Caja: sin precio"],
      ["Clave: T-1", "Cambió: Caja: $500.00"],
      ["Clave: T-1", "Cambió: Pieza: $1.50"],
    ]);
  });

  it("the cashier reads prices without margin and cannot change them", async () => {
    const actor = await salesCompany();
    const { productId } = await screwWithBox(actor);
    await setSalePrices(actor, productId, {
      unitPrice: "2",
      presentations: {},
    });
    const cajero = await salesMember(actor.organizationId, "cashier");
    const prices = await getSalePrices(cajero, productId);
    expect(prices?.rows[0]).toEqual({
      presentationId: null,
      label: "Pieza",
      factor: "1",
      price: "2.00",
      sellsAt: "$2.00",
      derived: false,
    });
    expect(prices?.rows[0]).not.toHaveProperty("margin");
    await expect(
      setSalePrices(cajero, productId, { unitPrice: "1", presentations: {} }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses unreadable prices, writing nothing", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screwWithBox(actor);
    expect(
      await setSalePrices(actor, productId, {
        unitPrice: "1.505",
        presentations: { [boxId]: "caro" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: { unit: expect.any(String), [boxId]: expect.any(String) },
    });
    expect(await db.salePrice.count({ where: { productId } })).toBe(0);
  });

  it("does not reach another company's product", async () => {
    const actor = await salesCompany();
    const other = await salesCompany();
    const { productId, boxId } = await screwWithBox(other);
    expect(await getSalePrices(actor, productId)).toBeNull();
    expect(
      await setSalePrices(actor, productId, {
        unitPrice: "1",
        presentations: { [boxId]: "1" },
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await db.salePrice.count({ where: { productId } })).toBe(0);
  });

  it("does not exist without Ventas", async () => {
    const actor = await salesCompany();
    await db.entitlement.deleteMany({
      where: { organizationId: actor.organizationId, key: "sales" },
    });
    invalidateEntitlements(actor.organizationId);
    const { productId } = await screwWithBox(actor);
    await expect(getSalePrices(actor, productId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
