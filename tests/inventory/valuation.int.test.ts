import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import {
  reconcileStock,
  registerEntry,
  registerExit,
  registerInitialBalance,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { createPresentation, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// VAL-03 (ADR 0031): a cost typed in an entry or an initial balance moves
// the average cost, only for who may record costs; exits leave at the
// average.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `costos.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<InventoryActor> {
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
      productLimit: 20,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de costos",
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
async function product(actor: InventoryActor) {
  const created = await createProduct(actor, {
    sku: `C-${++skus}`,
    name: `Martillo ${skus}`,
  });
  if (!created.ok) throw new Error("product setup failed");
  return created.productId;
}

const costOf = async (productId: string) => {
  const row = await db.productCost.findFirst({ where: { productId } });
  return row
    ? `${row.averageCost.toFixed(2)} / ${row.stockValue.toFixed(2)}`
    : null;
};

const lineCosts = async (productId: string) =>
  (
    await db.stockMovementLine.findMany({
      where: { productId },
      orderBy: { createdAt: "asc" },
      select: { direction: true, unitCost: true },
    })
  ).map((line) => `${line.direction} ${line.unitCost?.toFixed(2) ?? "-"}`);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("costs typed in entries", () => {
  it("move the average; entries without one and exits use it", async () => {
    const actor = await company();
    const martillo = await product(actor);
    expect(
      await registerInitialBalance(actor, {
        productId: martillo,
        quantity: "10",
        unitCost: "$85",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "10",
        unitCost: "95.00",
      }),
    ).toMatchObject({ ok: true });
    expect(await costOf(martillo)).toBe("90.00 / 1800.00");

    await registerEntry(actor, { productId: martillo, quantity: "5" });
    await registerExit(actor, { productId: martillo, quantity: "15" });
    expect(await costOf(martillo)).toBe("90.00 / 900.00");
    expect(await lineCosts(martillo)).toEqual([
      "IN 85.00",
      "IN 95.00",
      "IN 90.00",
      "OUT 90.00",
    ]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("a cost per box is divided by its content", async () => {
    const actor = await company();
    const tornillo = await product(actor);
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "500",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "2",
      presentationId: caja.presentationId,
      unitCost: "450",
    });
    expect(await costOf(tornillo)).toBe("0.90 / 900.00");
  });

  it("only who may record costs types one; Almacén enters at the average", async () => {
    const actor = await company();
    const martillo = await product(actor);
    await registerEntry(actor, {
      productId: martillo,
      quantity: "2",
      unitCost: "50",
    });
    const almacen = await member(actor.organizationId, "warehouse");
    await expect(
      registerEntry(almacen, {
        productId: martillo,
        quantity: "1",
        unitCost: "1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await registerEntry(almacen, { productId: martillo, quantity: "2" }),
    ).toMatchObject({ ok: true });
    expect(await costOf(martillo)).toBe("50.00 / 200.00");

    const comprador = await member(actor.organizationId, "buyer");
    // The buyer may record costs but not register entries.
    await expect(
      registerEntry(comprador, {
        productId: martillo,
        quantity: "1",
        unitCost: "10",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses unreadable costs and costs on exits, writing nothing", async () => {
    const actor = await company();
    const martillo = await product(actor);
    expect(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "1",
        unitCost: "doce",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { unitCost: expect.any(String) },
    });
    expect(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "1",
        unitCost: "1.12345",
      }),
    ).toMatchObject({ ok: false });
    await registerEntry(actor, { productId: martillo, quantity: "3" });
    expect(
      await registerExit(actor, {
        productId: martillo,
        quantity: "1",
        unitCost: "5",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { unitCost: expect.any(String) },
    });
    expect(await lineCosts(martillo)).toEqual(["IN -"]);
    expect(await costOf(martillo)).toBeNull();
  });
});
