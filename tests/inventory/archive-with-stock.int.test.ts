import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockTotals,
  reconcileStock,
  registerEntry,
  registerExit,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { archiveProduct, createProduct, getProduct } from "@/platform/catalog";
import { getQuotaUsage, invalidateEntitlements } from "@/platform/entitlements";
import {
  archiveLocation,
  createLocation,
  listLocations,
} from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// INV-19B: a product or a location with stock is not archived (NEG-21).

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `archivo-stock.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de archivo con existencias",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function product(
  actor: InventoryActor,
  card: { name: string; unit?: string; step?: string },
) {
  const result = await createProduct(actor, { sku: `A-${++counter}`, ...card });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

async function shelf(actor: InventoryActor, name: string) {
  const result = await createLocation(actor, { kind: "SHELF", name });
  if (!result.ok) throw new Error("location setup failed");
  return result.locationId;
}

const used = async (actor: InventoryActor) =>
  (await getQuotaUsage(actor.organizationId, "active_products")).used;

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("archiving a product", () => {
  it("is refused while it has stock in any location, and nothing changes", async () => {
    const actor = await company();
    const a = await shelf(actor, "Estante A");
    const screws = await product(actor, { name: "Tornillo" });
    await registerEntry(actor, { productId: screws, quantity: "1" });
    const places = await used(actor);
    expect(await archiveProduct(actor, screws)).toEqual({
      ok: false,
      reason: "has_stock",
      error:
        "Todavía hay 1 pieza de este producto. Regístralas como salida o ajústalas a cero antes de archivarlo.",
    });
    await registerEntry(actor, {
      productId: screws,
      locationId: a,
      quantity: "1,274",
    });
    expect(await archiveProduct(actor, screws, "Ya no lo vendo")).toEqual({
      ok: false,
      reason: "has_stock",
      error:
        "Todavía hay 1,275 piezas de este producto en 2 ubicaciones. Regístralas como salida o ajústalas a cero antes de archivarlo.",
    });
    expect(await getProduct(actor, screws)).toMatchObject({ status: "ACTIVE" });
    // The place of the plan is still taken and nothing was recorded.
    expect(await used(actor)).toBe(places);
    expect(
      await forOrganization(actor.organizationId).auditEvent.count({
        where: { action: "product.archived" },
      }),
    ).toBe(0);
  });

  it("is allowed once its stock is zero everywhere", async () => {
    const actor = await company();
    const a = await shelf(actor, "Estante A");
    const cable = await product(actor, { name: "Cable", unit: "m" });
    await registerEntry(actor, { productId: cable, quantity: "12.5" });
    await registerEntry(actor, {
      productId: cable,
      locationId: a,
      quantity: "3",
    });
    await registerExit(actor, { productId: cable, quantity: "12.5" });
    expect(await archiveProduct(actor, cable)).toMatchObject({
      ok: false,
      reason: "has_stock",
      error: expect.stringContaining("Todavía hay 3 metros de este producto."),
    });
    await registerExit(actor, {
      productId: cable,
      locationId: a,
      quantity: "3",
    });
    expect(await archiveProduct(actor, cable)).toEqual({ ok: true });
    expect(await getProduct(actor, cable)).toMatchObject({
      status: "ARCHIVED",
    });
    // Its history stays, and nothing enters an archived product.
    expect(
      await forOrganization(actor.organizationId).stockMovementLine.count({
        where: { productId: cable },
      }),
    ).toBe(4);
    expect(
      await registerEntry(actor, { productId: cable, quantity: "1" }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("a product that never moved is archived as before", async () => {
    const actor = await company();
    const productId = await product(actor, { name: "Sin movimientos" });
    expect(await archiveProduct(actor, productId)).toEqual({ ok: true });
  });

  it("archiving and receiving at the same time never leave an archived product with stock", async () => {
    const actor = await company();
    for (let round = 0; round < 10; round++) {
      const productId = await product(actor, { name: `Carrera ${round}` });
      const [archived, ...entries] = await Promise.all([
        archiveProduct(actor, productId),
        ...Array.from({ length: 4 }, () =>
          registerEntry(actor, { productId, quantity: "5" }),
        ),
      ]);
      const card = await getProduct(actor, productId);
      const total = (await getStockTotals(actor, [productId]))[productId];
      if (archived.ok) {
        // Archived first: every entry found it archived.
        expect(card?.status).toBe("ARCHIVED");
        expect(total).toBeUndefined();
        expect(entries.every((entry) => !entry.ok)).toBe(true);
      } else {
        // An entry came first: the archive was refused.
        expect(archived).toMatchObject({ reason: "has_stock" });
        expect(card?.status).toBe("ACTIVE");
        expect(total).toBe("20");
      }
    }
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);
});

describe("archiving a location", () => {
  it("is refused while it holds stock", async () => {
    const actor = await company();
    const a = await shelf(actor, "Estante A");
    const screws = await product(actor, { name: "Tornillo" });
    const nuts = await product(actor, { name: "Tuerca" });
    await registerEntry(actor, {
      productId: screws,
      locationId: a,
      quantity: "10",
    });
    expect(await archiveLocation(actor, a)).toMatchObject({
      ok: false,
      reason: "not_allowed",
      formError:
        "Todavía hay existencias de un producto aquí. Regístralas como salida o ajústalas a cero antes de archivarla.",
    });
    await registerEntry(actor, {
      productId: nuts,
      locationId: a,
      quantity: "4",
    });
    expect(await archiveLocation(actor, a)).toMatchObject({
      ok: false,
      formError:
        "Todavía hay existencias de 2 productos aquí. Regístralas como salida o ajústalas a cero antes de archivarla.",
    });
    // Emptied, it can be archived; and nothing enters it afterwards.
    await registerExit(actor, {
      productId: screws,
      locationId: a,
      quantity: "10",
    });
    await registerExit(actor, {
      productId: nuts,
      locationId: a,
      quantity: "4",
    });
    expect(await archiveLocation(actor, a)).toMatchObject({ ok: true });
    expect(
      await registerEntry(actor, {
        productId: screws,
        locationId: a,
        quantity: "1",
      }),
    ).toMatchObject({
      ok: false,
      reason: "not_allowed",
      fieldErrors: {
        locationId: "«Estante A» está archivada. Elige otra ubicación.",
      },
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("archiving and receiving at the same time never leave an archived location with stock", async () => {
    const actor = await company();
    const productId = await product(actor, { name: "Carrera" });
    for (let round = 0; round < 10; round++) {
      const locationId = await shelf(actor, `Estante ${round}`);
      const [archived, ...entries] = await Promise.all([
        archiveLocation(actor, locationId),
        ...Array.from({ length: 4 }, () =>
          registerEntry(actor, { productId, locationId, quantity: "5" }),
        ),
      ]);
      const stocked = await forOrganization(
        actor.organizationId,
      ).stockBalance.count({ where: { locationId, quantity: { gt: 0 } } });
      const isArchived = (
        await listLocations(actor, { includeArchived: true })
      )?.locations.find((location) => location.id === locationId)?.archived;
      if (archived.ok) {
        expect(isArchived).toBe(true);
        expect(stocked).toBe(0);
        expect(entries.every((entry) => !entry.ok)).toBe(true);
      } else {
        expect(isArchived).toBe(false);
        expect(stocked).toBe(1);
      }
    }
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);
});
