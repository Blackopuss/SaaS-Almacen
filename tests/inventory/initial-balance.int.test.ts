import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getInitialBalanceState,
  getStockByLocation,
  getStockTotals,
  listProductsWithoutStock,
  listRecentMovements,
  reconcileStock,
  registerEntry,
  registerInitialBalance,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation, getDefaultLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

import { migratorConnection } from "../setup/test-db";

// INV-18: the initial balance is a movement, never a number typed into the
// balance, and it cannot be edited afterwards.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `inicial.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de saldo inicial",
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
  actor: InventoryActor,
  card: { name: string; unit?: string; step?: string },
) {
  const result = await createProduct(actor, { sku: `S-${++counter}`, ...card });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

async function shelf(actor: InventoryActor, name: string) {
  const result = await createLocation(actor, { kind: "SHELF", name });
  if (!result.ok) throw new Error("location setup failed");
  return result.locationId;
}

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("registerInitialBalance", () => {
  it("is recorded as a movement that adds to the balance", async () => {
    const actor = await company();
    const general = (await getDefaultLocation(actor))?.id ?? "";
    const screws = await product(actor, { name: "Tornillo" });
    const result = await registerInitialBalance(actor, {
      productId: screws,
      quantity: "1,250",
      reason: "Conteo de arranque",
    });
    expect(result).toMatchObject({
      ok: true,
      summary: "Saldo inicial de Tornillo en General: 1,250 piezas.",
    });
    if (!result.ok) throw new Error("initial balance failed");
    const movement = await forOrganization(
      actor.organizationId,
    ).stockMovement.findFirstOrThrow({
      where: { id: result.movementId },
      include: { lines: true },
    });
    expect(movement).toMatchObject({
      type: "INITIAL",
      createdByUserId: actor.userId,
      reason: "Conteo de arranque",
    });
    expect(
      movement.lines.map((l) => [
        l.direction,
        l.locationId,
        l.capturedQuantity.toString(),
        l.factor.toString(),
        l.baseQuantity.toString(),
      ]),
    ).toEqual([["IN", general, "1250", "1", "1250"]]);
    expect(await getStockByLocation(actor, screws)).toEqual({
      [general]: "1250",
    });
    expect((await listRecentMovements(actor))[0]).toMatchObject({
      typeLabel: "Saldo inicial",
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("can be captured in boxes or in another unit, and per location", async () => {
    const actor = await company();
    const general = (await getDefaultLocation(actor))?.id ?? "";
    const a = await shelf(actor, "Estante A");
    const screws = await product(actor, { name: "Pija" });
    const box = await createPresentation(actor, screws, {
      name: "Caja",
      factor: "100",
    });
    if (!box.ok) throw new Error("presentation setup failed");
    expect(
      await registerInitialBalance(actor, {
        productId: screws,
        quantity: "3",
        presentationId: box.presentationId,
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Saldo inicial de Pija en General: 300 piezas (3 cajas × 100 = 300 piezas).",
    });
    // The same product in another location, before anything else moves it.
    expect(
      await registerInitialBalance(actor, {
        productId: screws,
        locationId: a,
        quantity: "40",
      }),
    ).toMatchObject({ ok: true });
    expect(await getStockByLocation(actor, screws)).toEqual({
      [general]: "300",
      [a]: "40",
    });
    expect(await getStockTotals(actor, [screws])).toEqual({ [screws]: "340" });
    expect(await getInitialBalanceState(actor, screws)).toEqual({
      open: true,
      capturedLocationIds: expect.arrayContaining([general, a]),
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("each location gets it once: a second capture is refused, not added", async () => {
    const actor = await company();
    const screws = await product(actor, { name: "Clavo" });
    await registerInitialBalance(actor, { productId: screws, quantity: "100" });
    expect(
      await registerInitialBalance(actor, {
        productId: screws,
        quantity: "80",
      }),
    ).toMatchObject({
      ok: false,
      reason: "not_allowed",
      fieldErrors: {
        locationId:
          "Ya capturaste el saldo inicial de este producto en «General». Elige otra ubicación.",
      },
    });
    // Also when several arrive at once: one is kept.
    const cable = await product(actor, { name: "Cable", unit: "m" });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        registerInitialBalance(actor, { productId: cable, quantity: "50" }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await getStockTotals(actor, [screws, cable])).toEqual({
      [screws]: "100",
      [cable]: "50",
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("comes before any other movement of the product", async () => {
    const actor = await company();
    const a = await shelf(actor, "Estante A");
    const screws = await product(actor, { name: "Tuerca" });
    await registerEntry(actor, { productId: screws, quantity: "10" });
    // Not in the location that already moved, nor in another one.
    for (const locationId of [undefined, a]) {
      expect(
        await registerInitialBalance(actor, {
          productId: screws,
          locationId,
          quantity: "500",
        }),
      ).toMatchObject({
        ok: false,
        reason: "not_allowed",
        fieldErrors: {
          productId:
            "Este producto ya tiene movimientos: su saldo inicial ya no se captura. Usa una entrada, o un ajuste si la cantidad no coincide.",
        },
      });
    }
    expect(await getInitialBalanceState(actor, screws)).toMatchObject({
      open: false,
    });
    expect(await getStockTotals(actor, [screws])).toEqual({ [screws]: "10" });
    // After an initial balance, entries go on as usual.
    const other = await product(actor, { name: "Rondana" });
    await registerInitialBalance(actor, { productId: other, quantity: "7" });
    expect(
      await registerEntry(actor, { productId: other, quantity: "3" }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 3 piezas de Rondana a General. Ahora hay 10 piezas ahí.",
    });
  });

  it("is never edited: neither the movement nor its quantity", async () => {
    const actor = await company();
    const screws = await product(actor, { name: "Remache" });
    const result = await registerInitialBalance(actor, {
      productId: screws,
      quantity: "100",
    });
    if (!result.ok) throw new Error("initial balance failed");
    const connection = await migratorConnection();
    try {
      await expect(
        connection.query(
          "UPDATE stock_movement SET reason = 'Otro' WHERE id = ?",
          [result.movementId],
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        connection.query(
          "UPDATE stock_movement_line SET capturedQuantity = 90, baseQuantity = 90 WHERE movementId = ?",
          [result.movementId],
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        connection.query(
          "DELETE FROM stock_movement_line WHERE movementId = ?",
          [result.movementId],
        ),
      ).rejects.toThrow(/immutable/);
    } finally {
      await connection.end();
    }
    expect(await getStockTotals(actor, [screws])).toEqual({ [screws]: "100" });
  });

  it("validates like an entry and writes nothing when refused", async () => {
    const actor = await company();
    const screws = await product(actor, { name: "Ancla" });
    const archived = await product(actor, { name: "Viejo" });
    await archiveProduct(actor, archived);
    for (const [input, expected] of [
      [{ productId: screws, quantity: "0" }, { reason: "invalid" }],
      [{ productId: screws, quantity: "2.5" }, { reason: "invalid" }],
      [{ productId: screws, quantity: "" }, { reason: "invalid" }],
      [
        { productId: screws, quantity: "5", locationId: newId() },
        { reason: "not_found" },
      ],
      [{ productId: newId(), quantity: "5" }, { reason: "not_found" }],
      [
        { productId: archived, quantity: "5" },
        {
          reason: "not_allowed",
          fieldErrors: {
            productId:
              "Este producto está archivado. Reactívalo para registrar su saldo inicial.",
          },
        },
      ],
    ] as const) {
      expect(
        await registerInitialBalance(actor, input),
        JSON.stringify(input),
      ).toMatchObject({ ok: false, ...expected });
    }
    expect(
      await db.stockMovement.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(0);
  });

  it("is for Almacén and Administrador, with the plan in force, in their own company", async () => {
    const owner = await company();
    const other = await company();
    for (const role of ["warehouse", "administrator"] as const) {
      const person = await member(owner.organizationId, role);
      const productId = await product(owner, { name: `De ${role}` });
      expect(
        (await registerInitialBalance(person, { productId, quantity: "5" })).ok,
        role,
      ).toBe(true);
    }
    const productId = await product(owner, { name: "Pendiente" });
    for (const role of ["buyer", "viewer"] as const) {
      const person = await member(owner.organizationId, role);
      await expect(
        registerInitialBalance(person, { productId, quantity: "5" }),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
    // Another company: the product does not exist for them (NEG-12).
    expect(
      await registerInitialBalance(other, { productId, quantity: "5" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    await db.entitlement.updateMany({
      where: { organizationId: owner.organizationId },
      data: {
        validFrom: new Date(Date.now() - 2 * 86_400_000),
        validUntil: new Date(Date.now() - 86_400_000),
      },
    });
    invalidateEntitlements(owner.organizationId);
    await expect(
      registerInitialBalance(owner, { productId, quantity: "5" }),
    ).rejects.toMatchObject({ code: "module_read_only" });
    expect(await getStockTotals(owner, [productId])).toEqual({});
  });
});

describe("the guide of products without stock", () => {
  it("lists the active products nobody has moved, by name and in pages", async () => {
    const actor = await company();
    const names = Array.from({ length: 7 }, (_, i) => `Producto ${i + 1}`);
    const ids: Record<string, string> = {};
    for (const name of names) ids[name] = await product(actor, { name });
    const archived = await product(actor, { name: "Archivado" });
    await archiveProduct(actor, archived);

    expect(await listProductsWithoutStock(actor)).toMatchObject({
      total: 7,
      page: 1,
      pageCount: 1,
    });
    // Capturing an initial balance or an entry takes the product off it.
    await registerInitialBalance(actor, {
      productId: ids["Producto 2"] ?? "",
      quantity: "5",
    });
    await registerEntry(actor, {
      productId: ids["Producto 5"] ?? "",
      quantity: "5",
    });
    const first = await listProductsWithoutStock(actor, { pageSize: 3 });
    expect(first).toMatchObject({ total: 5, page: 1, pageCount: 2 });
    expect(first.items.map((p) => p.name)).toEqual([
      "Producto 1",
      "Producto 3",
      "Producto 4",
    ]);
    const second = await listProductsWithoutStock(actor, {
      pageSize: 3,
      page: 9,
    });
    expect(second.page).toBe(2);
    expect(second.items.map((p) => p.name)).toEqual([
      "Producto 6",
      "Producto 7",
    ]);
    // Another company has its own list.
    const other = await company();
    expect((await listProductsWithoutStock(other)).total).toBe(0);
  });
});
