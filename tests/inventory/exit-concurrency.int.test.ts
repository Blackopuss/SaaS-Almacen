import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  getStockTotals,
  reconcileStock,
  registerEntry,
  registerExit,
  type InventoryActor,
  type MovementResult,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation, getDefaultLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// INV-20: exits that arrive at the same time. Two for the last unit: only
// one goes through.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `concurrencia.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de concurrencia en salidas",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function product(actor: InventoryActor, name: string, unit?: string) {
  const result = await createProduct(actor, {
    sku: `C-${++counter}`,
    name,
    unit,
    step: unit ? "0.01" : undefined,
  });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

const succeeded = (results: MovementResult[]) =>
  results.filter((result) => result.ok).length;

const outLines = (actor: InventoryActor, productId: string) =>
  forOrganization(actor.organizationId).stockMovementLine.count({
    where: { productId, direction: "OUT" },
  });

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("simultaneous exits", () => {
  it("two for the last unit: only one goes through", async () => {
    const actor = await company();
    for (let round = 0; round < 8; round++) {
      const productId = await product(actor, `Última unidad ${round}`);
      await registerEntry(actor, { productId, quantity: "1" });
      const results = await Promise.all([
        registerExit(actor, { productId, quantity: "1" }),
        registerExit(actor, { productId, quantity: "1" }),
      ]);
      expect(succeeded(results), `round ${round}`).toBe(1);
      expect(results.find((result) => !result.ok)).toMatchObject({
        ok: false,
        reason: "invalid",
        fieldErrors: {
          quantity: `No hay existencias de Última unidad ${round} en General.`,
        },
      });
      expect(await getStockTotals(actor, [productId])).toEqual({
        [productId]: "0",
      });
      expect(await outLines(actor, productId)).toBe(1);
    }
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("twenty for seven units: exactly seven go through", async () => {
    const actor = await company();
    const productId = await product(actor, "Siete");
    await registerEntry(actor, { productId, quantity: "7" });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        registerExit(actor, { productId, quantity: "1" }),
      ),
    );
    expect(succeeded(results)).toBe(7);
    expect(await getStockTotals(actor, [productId])).toEqual({
      [productId]: "0",
    });
    expect(await outLines(actor, productId)).toBe(7);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("exits of different sizes never take more than there is", async () => {
    const actor = await company();
    const productId = await product(actor, "Cable", "m");
    await registerEntry(actor, { productId, quantity: "10" });
    // 12 requests that add up to 19.5 m against 10 m.
    const sizes = [
      "4",
      "3.5",
      "2.25",
      "2.25",
      "1",
      "1",
      "1",
      "1",
      "1",
      "1",
      "0.75",
      "0.75",
    ];
    const results = await Promise.all(
      sizes.map((quantity) => registerExit(actor, { productId, quantity })),
    );
    const taken = results.reduce(
      (sum, result, index) =>
        result.ok ? sum + Number(sizes[index]) * 100 : sum,
      0,
    );
    const left = (await getStockTotals(actor, [productId]))[productId];
    // What left plus what remains is what there was, to the hundredth.
    expect(taken + Number(left) * 100).toBe(1_000);
    expect(Number(left)).toBeGreaterThanOrEqual(0);
    expect(succeeded(results)).toBeLessThan(sizes.length);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("each location answers for its own stock", async () => {
    const actor = await company();
    const general = (await getDefaultLocation(actor))?.id ?? "";
    const shelf = await createLocation(actor, {
      kind: "SHELF",
      name: "Estante",
    });
    if (!shelf.ok) throw new Error("location setup failed");
    const productId = await product(actor, "Repartido");
    await registerEntry(actor, { productId, quantity: "3" });
    await registerEntry(actor, {
      productId,
      locationId: shelf.locationId,
      quantity: "2",
    });
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        registerExit(actor, {
          productId,
          locationId: i % 2 === 0 ? general : shelf.locationId,
          quantity: "1",
        }),
      ),
    );
    expect(succeeded(results.filter((_, i) => i % 2 === 0)), "General").toBe(3);
    expect(succeeded(results.filter((_, i) => i % 2 === 1)), "Estante").toBe(2);
    expect(await getStockByLocation(actor, productId)).toEqual({});
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("entries and exits mixed at once always add up", async () => {
    const actor = await company();
    const productId = await product(actor, "Mezclado");
    await registerEntry(actor, { productId, quantity: "5" });
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        i % 3 === 0
          ? registerEntry(actor, { productId, quantity: "2" })
          : registerExit(actor, { productId, quantity: "1" }),
      ),
    );
    // 10 entries of 2 always succeed; each exit that succeeded took 1.
    const exits = succeeded(results.filter((_, i) => i % 3 !== 0));
    expect(succeeded(results.filter((_, i) => i % 3 === 0))).toBe(10);
    expect(await getStockTotals(actor, [productId])).toEqual({
      [productId]: String(5 + 20 - exits),
    });
    expect(exits).toBeGreaterThan(0);
    expect(exits).toBeLessThanOrEqual(20);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("different products do not wait for each other and each keeps its count", async () => {
    const actor = await company();
    const ids = await Promise.all(
      Array.from({ length: 5 }, (_, i) => product(actor, `Paralelo ${i}`)),
    );
    for (const productId of ids) {
      await registerEntry(actor, { productId, quantity: "2" });
    }
    const results = await Promise.all(
      ids.flatMap((productId) =>
        Array.from({ length: 4 }, () =>
          registerExit(actor, { productId, quantity: "1" }),
        ),
      ),
    );
    expect(succeeded(results)).toBe(10);
    expect(await getStockTotals(actor, ids)).toEqual(
      Object.fromEntries(ids.map((productId) => [productId, "0"])),
    );
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);
});
