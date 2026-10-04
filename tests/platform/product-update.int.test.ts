import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  createProduct,
  getProduct,
  updateProduct,
  type CatalogActor,
  type ProductInput,
} from "@/platform/catalog";
import { getQuotaUsage, invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-03: editing the card. Changes are audited; the quantity is not
// edited from here.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `ficha.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<CatalogActor> {
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
      productLimit: 50,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de edición de ficha",
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

const card = (change: Partial<ProductInput> = {}): ProductInput => ({
  sku: "TOR-001",
  name: "Tornillo hexagonal 1/4",
  description: "Galvanizado.",
  category: "Tornillería",
  brand: "Truper",
  barcode: "7501234567890",
  ...change,
});

async function newProduct(
  actor: CatalogActor,
  change: Partial<ProductInput> = {},
) {
  const result = await createProduct(actor, card(change));
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

let actor: CatalogActor;

beforeAll(async () => {
  actor = await company();
});

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("updateProduct", () => {
  it("changes the card and records what changed, before and after", async () => {
    const mine = await company();
    const id = await newProduct(mine);
    expect(
      await updateProduct(
        mine,
        id,
        card({
          name: "Tornillo hexagonal 1/4 x 1",
          brand: "Urrea",
          barcode: "",
        }),
      ),
    ).toEqual({ ok: true, productId: id });

    expect(await getProduct(mine, id)).toMatchObject({
      sku: "TOR-001",
      name: "Tornillo hexagonal 1/4 x 1",
      category: "Tornillería",
      brand: "Urrea",
      barcode: null,
      status: "ACTIVE",
    });
    const event = await db.auditEvent.findFirstOrThrow({
      where: {
        organizationId: mine.organizationId,
        action: "product.updated",
        targetId: id,
      },
    });
    expect(event.actorUserId).toBe(mine.userId);
    expect(event.metadata).toEqual({
      sku: "TOR-001",
      changes: {
        Nombre: {
          antes: "Tornillo hexagonal 1/4",
          ahora: "Tornillo hexagonal 1/4 x 1",
        },
        Marca: { antes: "Truper", ahora: "Urrea" },
        "Código de barras": { antes: "7501234567890", ahora: null },
      },
    });
  });

  it("saving without changes writes nothing", async () => {
    const mine = await company();
    const id = await newProduct(mine);
    expect(await updateProduct(mine, id, card())).toMatchObject({
      ok: false,
      reason: "unchanged",
      formError: "No hay cambios que guardar.",
    });
    expect(
      await db.auditEvent.count({
        where: {
          organizationId: mine.organizationId,
          action: "product.updated",
        },
      }),
    ).toBe(0);
  });

  it("does not take or free quota", async () => {
    const mine = await company();
    const id = await newProduct(mine);
    await updateProduct(mine, id, card({ name: "Otro nombre" }));
    expect(
      (await getQuotaUsage(mine.organizationId, "active_products")).used,
    ).toBe(1);
  });

  it("the quantity cannot be edited from the card", async () => {
    const mine = await company();
    const id = await newProduct(mine);
    const sneaky = {
      ...card({ name: "Con cantidad" }),
      quantity: 500,
      stock: "500",
      status: "ARCHIVED",
      organizationId: actor.organizationId,
    } as ProductInput;
    expect(await updateProduct(mine, id, sneaky)).toMatchObject({ ok: true });
    const stored = await db.product.findUniqueOrThrow({ where: { id } });
    // Only the card changed: same company, same status, and there is no
    // quantity column to write to.
    expect(stored).toMatchObject({
      organizationId: mine.organizationId,
      status: "ACTIVE",
      name: "Con cantidad",
    });
    expect(Object.keys(stored)).not.toContain("quantity");
    expect(Object.keys(stored)).not.toContain("stock");
    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "product.updated", targetId: id },
    });
    expect(JSON.stringify(event.metadata)).not.toMatch(/quantity|stock|500/);
  });

  it("refuses the SKU or barcode of another product, but keeps its own", async () => {
    const mine = await company();
    const first = await newProduct(mine);
    const second = await newProduct(mine, {
      sku: "TOR-002",
      barcode: "7500000000002",
    });
    expect(
      await updateProduct(
        mine,
        second,
        card({ sku: "tor-001", barcode: "7500000000002" }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "duplicate",
      fieldErrors: { sku: expect.any(String) },
    });
    expect(
      await updateProduct(mine, second, card({ sku: "TOR-002" })),
    ).toMatchObject({
      ok: false,
      reason: "duplicate",
      fieldErrors: { barcode: expect.any(String) },
    });
    // Its own code written with other capitals is a change, not a clash.
    expect(
      await updateProduct(
        mine,
        second,
        card({ sku: "tor-002", barcode: "7500000000002" }),
      ),
    ).toMatchObject({ ok: true });
    expect((await getProduct(mine, first))?.sku).toBe("TOR-001");
  });

  it("validates like a new product", async () => {
    const mine = await company();
    const id = await newProduct(mine);
    expect(
      await updateProduct(mine, id, card({ sku: " ", name: "X" })),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: { sku: expect.any(String), name: expect.any(String) },
    });
  });

  it("an unknown product is not found", async () => {
    expect(await updateProduct(actor, newId(), card())).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await getProduct(actor, newId())).toBeNull();
  });
});

describe("who can edit", () => {
  it("Almacén can; Comprador and Consulta cannot", async () => {
    const mine = await company();
    const id = await newProduct(mine);
    const warehouse = await member(mine.organizationId, "warehouse");
    expect(
      await updateProduct(warehouse, id, card({ name: "Por almacén" })),
    ).toMatchObject({ ok: true });
    for (const role of ["buyer", "viewer"] as const) {
      const other = await member(mine.organizationId, role);
      await expect(
        updateProduct(other, id, card({ name: "Sin permiso" })),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
      expect((await getProduct(other, id))?.name).toBe("Por almacén");
    }
  });

  it("a product of another company cannot be read or changed", async () => {
    const mine = await company();
    const theirs = await company();
    const id = await newProduct(theirs);
    expect(await getProduct(mine, id)).toBeNull();
    expect(
      await updateProduct(mine, id, card({ name: "Hackeado" })),
    ).toMatchObject({ ok: false, reason: "not_found" });
    await expect(
      updateProduct(
        { organizationId: theirs.organizationId, userId: mine.userId },
        id,
        card({ name: "Hackeado" }),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect((await getProduct(theirs, id))?.name).toBe("Tornillo hexagonal 1/4");
  });

  it("with the plan expired the card can be read but not changed", async () => {
    const mine = await company();
    const id = await newProduct(mine);
    await db.entitlement.updateMany({
      where: { organizationId: mine.organizationId },
      data: {
        validFrom: new Date(Date.now() - 2 * 86_400_000),
        validUntil: new Date(Date.now() - 86_400_000),
      },
    });
    invalidateEntitlements(mine.organizationId);
    await expect(
      updateProduct(mine, id, card({ name: "Tarde" })),
    ).rejects.toMatchObject({ code: "module_read_only" });
    expect((await getProduct(mine, id))?.name).toBe("Tornillo hexagonal 1/4");
  });
});
