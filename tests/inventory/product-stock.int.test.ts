import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getProductStock,
  listRecentMovements,
  registerEntry,
  registerExit,
  registerTransfer,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  changePresentationFactor,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation, getDefaultLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-26: product card with the total, the breakdown by location and the
// equivalence in presentations.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `ficha.stock.${++counter}.${stamp}@example.test`,
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
      productLimit: 60,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de la ficha de producto",
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

async function product(
  owner: InventoryActor,
  name = "Tornillo",
  unit?: string,
) {
  const result = await createProduct(owner, {
    sku: `F-${++counter}`,
    name,
    ...(unit ? { unit } : {}),
  });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

async function place(owner: InventoryActor, name: string, parentId?: string) {
  const result = await createLocation(owner, {
    kind: parentId ? "SHELF" : "ZONE",
    name,
    ...(parentId ? { parentId } : {}),
  });
  if (!result.ok)
    throw new Error(`location setup failed: ${JSON.stringify(result)}`);
  return result.locationId;
}

let actor: InventoryActor;
let general = "";

beforeAll(async () => {
  actor = await company();
  general = (await getDefaultLocation(actor))?.id ?? "";
});

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("getProductStock", () => {
  it("gives the total and where it is, General first", async () => {
    const owner = await company();
    const tornillo = await product(owner);
    const zone = await place(owner, "Zona A");
    const shelf = await place(owner, "Estante 3", zone);
    const other = await place(owner, "Bodega");
    const home = (await getDefaultLocation(owner))?.id ?? "";
    await registerEntry(owner, {
      productId: tornillo,
      locationId: shelf,
      quantity: "120",
    });
    await registerEntry(owner, {
      productId: tornillo,
      locationId: other,
      quantity: "80",
    });
    await registerEntry(owner, { productId: tornillo, quantity: "50" });

    const stock = await getProductStock(owner, tornillo);
    expect(stock).toMatchObject({
      unitCode: "piece",
      total: "250",
      totalLabel: "250 piezas",
    });
    expect(
      stock?.locations.map((l) => [l.id, l.path, l.label, l.archived]),
    ).toEqual([
      [home, "General", "50 piezas", false],
      [other, "Bodega", "80 piezas", false],
      [shelf, "Zona A › Estante 3", "120 piezas", false],
    ]);
  });

  it("the total is the sum of its locations and follows every movement", async () => {
    const tornillo = await product(actor);
    const shelf = await place(actor, `Estante ${++counter}`);
    await registerEntry(actor, { productId: tornillo, quantity: "120" });
    await registerEntry(actor, {
      productId: tornillo,
      locationId: shelf,
      quantity: "80",
    });
    await registerTransfer(actor, {
      productId: tornillo,
      locationId: general,
      toLocationId: shelf,
      quantity: "20",
    });
    await registerExit(actor, {
      productId: tornillo,
      locationId: shelf,
      quantity: "30",
    });

    const stock = await getProductStock(actor, tornillo);
    expect(stock?.total).toBe("170");
    expect(
      stock?.locations.reduce((sum, l) => sum + Number(l.quantity), 0),
    ).toBe(170);
    expect(
      Object.fromEntries(stock!.locations.map((l) => [l.id, l.quantity])),
    ).toEqual({
      [general]: "100",
      [shelf]: "70",
    });
  });

  it("shows the total in each presentation, with its current content", async () => {
    const tornillo = await product(actor);
    await registerEntry(actor, { productId: tornillo, quantity: "250" });
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    await createPresentation(actor, tornillo, { name: "Bolsa", factor: "25" });
    await createPresentation(actor, tornillo, {
      name: "Tarima",
      factor: "5000",
    });
    if (!caja.ok) throw new Error("presentation setup failed");

    expect((await getProductStock(actor, tornillo))?.equivalences).toEqual([
      {
        presentation: "Bolsa",
        text: "250 piezas, equivalentes a 10 bolsas de 25",
      },
      {
        presentation: "Caja",
        text: "250 piezas, equivalentes a 2 cajas de 100 y 50 piezas",
      },
      // A pallet holds more than there is: nothing to say about it.
    ]);

    await changePresentationFactor(actor, caja.presentationId, {
      factor: "120",
    });
    expect(
      (await getProductStock(actor, tornillo))?.equivalences.find(
        (e) => e.presentation === "Caja",
      )?.text,
    ).toBe("250 piezas, equivalentes a 2 cajas de 120 y 10 piezas");
  });

  it("keeps decimals exact", async () => {
    const cable = await product(actor, "Cable", "m");
    const shelf = await place(actor, `Rack ${++counter}`);
    await registerEntry(actor, { productId: cable, quantity: "100.1" });
    await registerEntry(actor, {
      productId: cable,
      locationId: shelf,
      quantity: "100.2",
    });
    await createPresentation(actor, cable, { name: "Rollo", factor: "100" });
    const stock = await getProductStock(actor, cable);
    expect(stock).toMatchObject({ total: "200.3", totalLabel: "200.3 metros" });
    expect(stock?.equivalences).toEqual([
      {
        presentation: "Rollo",
        text: "200.3 metros, equivalentes a 2 rollos de 100 y 0.3 metros",
      },
    ]);
  });

  it("a product without stock has a total of zero and no locations", async () => {
    const tornillo = await product(actor);
    await createPresentation(actor, tornillo, { name: "Caja", factor: "100" });
    expect(await getProductStock(actor, tornillo)).toEqual({
      unitCode: "piece",
      total: "0",
      totalLabel: "0 piezas",
      locations: [],
      equivalences: [],
    });
  });

  it("a location emptied by exits disappears from the breakdown", async () => {
    const tornillo = await product(actor);
    await registerEntry(actor, { productId: tornillo, quantity: "10" });
    await registerExit(actor, { productId: tornillo, quantity: "10" });
    expect((await getProductStock(actor, tornillo))?.locations).toEqual([]);
  });

  it("answers nothing for a product of another company or an unknown id", async () => {
    const theirs = await company();
    const tornillo = await product(actor);
    await registerEntry(actor, { productId: tornillo, quantity: "10" });
    expect(await getProductStock(theirs, tornillo)).toBeNull();
    expect(await getProductStock(actor, newId())).toBeNull();
    await expect(
      getProductStock(
        { organizationId: actor.organizationId, userId: theirs.userId },
        tornillo,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("every role that reads stock can see it", async () => {
    const tornillo = await product(actor);
    await registerEntry(actor, { productId: tornillo, quantity: "10" });
    for (const role of ["warehouse", "buyer", "viewer"] as const) {
      const other = await member(actor.organizationId, role);
      expect((await getProductStock(other, tornillo))?.total, role).toBe("10");
    }
  });
});

describe("movements of one product", () => {
  it("lists only the movements that touched it, newest first", async () => {
    const tornillo = await product(actor);
    const clavo = await product(actor, "Clavo");
    await registerEntry(actor, { productId: tornillo, quantity: "10" });
    await registerEntry(actor, { productId: clavo, quantity: "99" });
    await registerExit(actor, { productId: tornillo, quantity: "4" });

    const listed = await listRecentMovements(actor, { productId: tornillo });
    expect(listed.map((m) => m.type)).toEqual(["EXIT", "ENTRY"]);
    expect(
      listed.every((m) => m.lines.every((l) => l.productId === tornillo)),
    ).toBe(true);
    expect(await listRecentMovements(actor, { productId: newId() })).toEqual(
      [],
    );
  });
});
