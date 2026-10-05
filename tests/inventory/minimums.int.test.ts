import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  LOW_STOCK_PAGE_SIZE,
  countLowStock,
  getMinimum,
  listLowStock,
  registerEntry,
  registerExit,
  setMinimum,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { archiveProduct, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-30: minimums and the list of low stock, derived from real balances.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `minimos.${++counter}.${stamp}@example.test`,
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
      productLimit: 200,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de mínimos",
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

/** A product with stock in «General» (none when `quantity` is empty). */
async function product(
  owner: InventoryActor,
  name: string,
  quantity = "",
  unit?: string,
) {
  const result = await createProduct(owner, {
    sku: `M-${++counter}`,
    name,
    ...(unit ? { unit } : {}),
  });
  if (!result.ok) throw new Error("product setup failed");
  if (quantity) {
    const entry = await registerEntry(owner, {
      productId: result.productId,
      quantity,
    });
    if (!entry.ok) throw new Error("entry setup failed");
  }
  return result.productId;
}

const lowNames = async (owner: InventoryActor) =>
  (await listLowStock(owner)).items.map((item) => item.name);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("setMinimum", () => {
  let actor: InventoryActor;
  beforeAll(async () => {
    actor = await company();
  }, 60_000);

  it("sets, changes and removes the minimum of a product", async () => {
    const tornillo = await product(actor, "Tornillo", "100");
    expect(await getMinimum(actor, tornillo)).toBeNull();
    expect(
      await setMinimum(actor, { productId: tornillo, quantity: "20" }),
    ).toEqual({
      ok: true,
      minimum: "20",
      summary: "Mínimo de Tornillo: 20 piezas.",
    });
    expect(await getMinimum(actor, tornillo)).toBe("20");
    await setMinimum(actor, { productId: tornillo, quantity: " 1,500 " });
    expect(await getMinimum(actor, tornillo)).toBe("1500");
    expect(
      await db.stockMinimum.count({ where: { productId: tornillo } }),
    ).toBe(1);
    expect(
      await setMinimum(actor, { productId: tornillo, quantity: "" }),
    ).toEqual({
      ok: true,
      minimum: null,
      summary: "Tornillo ya no tiene mínimo.",
    });
    expect(await getMinimum(actor, tornillo)).toBeNull();
  });

  it("follows the quantity rule of the product", async () => {
    const tornillo = await product(actor, "Tornillo entero");
    const cable = await product(actor, "Cable", "", "m");
    for (const quantity of ["0.5", "0", "-3", "muchos"]) {
      expect(
        await setMinimum(actor, { productId: tornillo, quantity }),
      ).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(await getMinimum(actor, tornillo)).toBeNull();
    expect(
      await setMinimum(actor, { productId: cable, quantity: "2.5" }),
    ).toMatchObject({ ok: true, minimum: "2.5" });
  });

  it("only who may change minimums, and only in their company", async () => {
    const tornillo = await product(actor, "Tornillo vigilado");
    const viewer = await member(actor.organizationId, "viewer");
    await expect(
      setMinimum(viewer, { productId: tornillo, quantity: "5" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(await getMinimum(viewer, tornillo)).toBeNull();

    const theirs = await company();
    expect(
      await setMinimum(theirs, { productId: tornillo, quantity: "5" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await setMinimum(actor, { productId: newId(), quantity: "5" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await getMinimum(actor, tornillo)).toBeNull();
  });
});

describe("listLowStock", () => {
  it("lists what is at or below its minimum, the emptiest first", async () => {
    const actor = await company();
    const agotado = await product(actor, "Agotado");
    const casi = await product(actor, "Casi agotado", "2");
    const justo = await product(actor, "Justo en la línea", "10");
    const sobrado = await product(actor, "Sobrado", "11");
    await product(actor, "Sin mínimo", "0.5", "m");
    for (const productId of [agotado, casi, justo, sobrado]) {
      await setMinimum(actor, { productId, quantity: "10" });
    }
    const page = await listLowStock(actor);
    expect(page).toMatchObject({
      total: 3,
      page: 1,
      pageCount: 1,
      withMinimum: 4,
    });
    expect(page.items.map((item) => item.name)).toEqual([
      "Agotado",
      "Casi agotado",
      "Justo en la línea",
    ]);
    expect(page.items[0]).toMatchObject({
      productId: agotado,
      stock: "0",
      stockLabel: "0 piezas",
      minimumLabel: "10 piezas",
      missingLabel: "10 piezas",
      empty: true,
    });
    expect(page.items[1]).toMatchObject({
      stockLabel: "2 piezas",
      missingLabel: "8 piezas",
      empty: false,
    });
    expect(await countLowStock(actor)).toBe(3);
  });

  it("follows the real balance: every movement moves the list", async () => {
    const actor = await company();
    const tornillo = await product(actor, "Tornillo", "30");
    await setMinimum(actor, { productId: tornillo, quantity: "20" });
    expect(await lowNames(actor)).toEqual([]);
    await registerExit(actor, { productId: tornillo, quantity: "10" });
    expect(await lowNames(actor)).toEqual(["Tornillo"]);
    await registerEntry(actor, { productId: tornillo, quantity: "1" });
    expect(await lowNames(actor)).toEqual([]);
    // Raising the line makes it low again without any movement.
    await setMinimum(actor, { productId: tornillo, quantity: "21" });
    expect(await lowNames(actor)).toEqual(["Tornillo"]);
    await setMinimum(actor, { productId: tornillo, quantity: "" });
    expect(await lowNames(actor)).toEqual([]);
  });

  it("adds up every location of the product", async () => {
    const actor = await company();
    const tornillo = await product(actor, "Tornillo repartido", "6");
    const shelf = await createLocation(actor, {
      kind: "SHELF",
      name: "Estante 1",
    });
    if (!shelf.ok) throw new Error("location setup failed");
    await setMinimum(actor, { productId: tornillo, quantity: "10" });
    expect(await lowNames(actor)).toEqual(["Tornillo repartido"]);
    await registerEntry(actor, {
      productId: tornillo,
      locationId: shelf.locationId,
      quantity: "5",
    });
    expect(await lowNames(actor)).toEqual([]);
  });

  it("leaves archived products out", async () => {
    const actor = await company();
    const viejo = await product(actor, "Descontinuado");
    await setMinimum(actor, { productId: viejo, quantity: "5" });
    expect(await lowNames(actor)).toEqual(["Descontinuado"]);
    await archiveProduct(actor, viejo);
    expect(await listLowStock(actor)).toMatchObject({
      total: 0,
      withMinimum: 0,
    });
  });

  it("is separate for each company", async () => {
    const ours = await company();
    const theirs = await company();
    const nuestro = await product(ours, "Nuestro");
    const suyo = await product(theirs, "Suyo", "3");
    await setMinimum(ours, { productId: nuestro, quantity: "5" });
    await setMinimum(theirs, { productId: suyo, quantity: "5" });
    expect(await lowNames(ours)).toEqual(["Nuestro"]);
    expect(await lowNames(theirs)).toEqual(["Suyo"]);
    expect(await getMinimum(ours, suyo)).toBeNull();
    // Someone from another company cannot read this one's list.
    await expect(
      listLowStock({
        organizationId: ours.organizationId,
        userId: theirs.userId,
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("shows one page at a time", async () => {
    const actor = await company();
    for (let i = 0; i < LOW_STOCK_PAGE_SIZE + 2; i++) {
      const id = await product(actor, `Producto ${String(i).padStart(2, "0")}`);
      await setMinimum(actor, { productId: id, quantity: "1" });
    }
    const first = await listLowStock(actor);
    expect(first).toMatchObject({
      total: LOW_STOCK_PAGE_SIZE + 2,
      pageCount: 2,
    });
    expect(first.items).toHaveLength(LOW_STOCK_PAGE_SIZE);
    expect(first.items[0]!.name).toBe("Producto 00");
    const second = await listLowStock(actor, { page: 2 });
    expect(second.items.map((item) => item.name)).toEqual([
      "Producto 25",
      "Producto 26",
    ]);
    expect((await listLowStock(actor, { page: 99 })).page).toBe(2);
  }, 120_000);

  it("roles that read minimums see the list; it needs the module", async () => {
    const actor = await company();
    const tornillo = await product(actor, "Tornillo");
    await setMinimum(actor, { productId: tornillo, quantity: "5" });
    for (const role of ["warehouse", "buyer", "viewer"] as const) {
      const person = await member(actor.organizationId, role);
      expect((await listLowStock(person)).total).toBe(1);
    }
  });
});
