import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  getStockTotals,
  listRecentMovements,
  reconcileStock,
  registerEntry,
  registerExit,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  changePresentationFactor,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation, getDefaultLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// INV-19: exits, and stock that never goes below zero (MOV-01).

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `salidas.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de salidas",
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
  const result = await createProduct(actor, { sku: `X-${++counter}`, ...card });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

async function shelf(actor: InventoryActor, name: string) {
  const result = await createLocation(actor, { kind: "SHELF", name });
  if (!result.ok) throw new Error("location setup failed");
  return result.locationId;
}

const movements = (actor: InventoryActor) =>
  db.stockMovement.count({ where: { organizationId: actor.organizationId } });

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("registerExit", () => {
  it("takes stock out of a location and says what is left", async () => {
    const actor = await company();
    const general = (await getDefaultLocation(actor))?.id ?? "";
    const screws = await product(actor, { name: "Tornillo" });
    await registerEntry(actor, { productId: screws, quantity: "300" });
    const result = await registerExit(actor, {
      productId: screws,
      quantity: "25",
      reference: "Nota 4471",
      reason: "Venta de mostrador",
    });
    expect(result).toMatchObject({
      ok: true,
      summary:
        "Salieron 25 piezas de Tornillo de General. Quedan 275 piezas ahí.",
    });
    if (!result.ok) throw new Error("exit failed");
    const movement = await forOrganization(
      actor.organizationId,
    ).stockMovement.findFirstOrThrow({
      where: { id: result.movementId },
      include: { lines: true },
    });
    expect(movement).toMatchObject({
      type: "EXIT",
      createdByUserId: actor.userId,
      reference: "Nota 4471",
      reason: "Venta de mostrador",
    });
    expect(
      movement.lines.map((l) => [
        l.direction,
        l.locationId,
        l.capturedQuantity.toString(),
        l.factor.toString(),
        l.baseQuantity.toString(),
        l.unitCode,
      ]),
    ).toEqual([["OUT", general, "25", "1", "25", "piece"]]);
    expect(await getStockTotals(actor, [screws])).toEqual({ [screws]: "275" });
    expect((await listRecentMovements(actor))[0]).toMatchObject({
      typeLabel: "Salida",
      lines: [{ direction: "OUT", quantity: "25 piezas", location: "General" }],
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("an exit larger than the balance of the location is refused (MOV-01)", async () => {
    const actor = await company();
    const screws = await product(actor, { name: "Pija" });
    await registerEntry(actor, { productId: screws, quantity: "20" });
    const before = await movements(actor);
    expect(
      await registerExit(actor, { productId: screws, quantity: "25" }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: {
        quantity: "Solo hay 20 piezas en General: no pueden salir 25 piezas.",
      },
    });
    expect(
      await registerExit(actor, { productId: screws, quantity: "21" }),
    ).toMatchObject({ ok: false });
    // Nothing was written and the stock is the same.
    expect(await movements(actor)).toBe(before);
    expect(await getStockTotals(actor, [screws])).toEqual({ [screws]: "20" });

    // Everything can leave; after that there is nothing to take.
    expect(
      await registerExit(actor, { productId: screws, quantity: "19" }),
    ).toMatchObject({
      ok: true,
      summary: "Salieron 19 piezas de Pija de General. Queda 1 pieza ahí.",
    });
    expect(
      await registerExit(actor, { productId: screws, quantity: "1" }),
    ).toMatchObject({
      ok: true,
      summary: "Salió 1 pieza de Pija de General. Quedan 0 piezas ahí.",
    });
    expect(
      await registerExit(actor, { productId: screws, quantity: "1" }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { quantity: "No hay existencias de Pija en General." },
    });
    expect(await getStockTotals(actor, [screws])).toEqual({ [screws]: "0" });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("what counts is the balance of that location, not the total", async () => {
    const actor = await company();
    const general = (await getDefaultLocation(actor))?.id ?? "";
    const a = await shelf(actor, "Estante A");
    const b = await shelf(actor, "Estante B");
    const screws = await product(actor, { name: "Clavo" });
    await registerEntry(actor, { productId: screws, quantity: "100" });
    await registerEntry(actor, {
      productId: screws,
      locationId: a,
      quantity: "5",
    });
    // 105 in total, but only 5 on the shelf.
    expect(
      await registerExit(actor, {
        productId: screws,
        locationId: a,
        quantity: "10",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        quantity: "Solo hay 5 piezas en Estante A: no pueden salir 10 piezas.",
      },
    });
    // A location that never had this product.
    expect(
      await registerExit(actor, {
        productId: screws,
        locationId: b,
        quantity: "1",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { quantity: "No hay existencias de Clavo en Estante B." },
    });
    expect(
      await registerExit(actor, {
        productId: screws,
        locationId: a,
        quantity: "5",
      }),
    ).toMatchObject({ ok: true });
    expect(await getStockByLocation(actor, screws)).toEqual({
      [general]: "100",
    });
  });

  it("the mandatory case: 300 − 25 = 275, a new box of 120 → 395; 200 m − 2.75 m = 197.25 m", async () => {
    const actor = await company();
    const screws = await product(actor, { name: "Tornillo" });
    const box = await createPresentation(actor, screws, {
      name: "Caja",
      factor: "100",
    });
    if (!box.ok) throw new Error("presentation setup failed");
    const boxId = box.presentationId;
    await registerEntry(actor, {
      productId: screws,
      quantity: "3",
      presentationId: boxId,
    });
    expect(
      await registerExit(actor, { productId: screws, quantity: "25" }),
    ).toMatchObject({
      ok: true,
      summary:
        "Salieron 25 piezas de Tornillo de General. Quedan 275 piezas ahí.",
    });
    await changePresentationFactor(actor, boxId, { factor: "120" });
    expect(
      await registerEntry(actor, {
        productId: screws,
        quantity: "1",
        presentationId: boxId,
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 120 piezas de Tornillo a General (1 caja × 120 = 120 piezas). Ahora hay 395 piezas ahí.",
    });

    const cable = await product(actor, {
      name: "Cable",
      unit: "m",
      step: "0.01",
    });
    const roll = await createPresentation(actor, cable, {
      name: "Rollo",
      factor: "100",
    });
    if (!roll.ok) throw new Error("presentation setup failed");
    await registerEntry(actor, {
      productId: cable,
      quantity: "2",
      presentationId: roll.presentationId,
    });
    expect(
      await registerExit(actor, { productId: cable, quantity: "2.75" }),
    ).toMatchObject({
      ok: true,
      summary:
        "Salieron 2.75 metros de Cable de General. Quedan 197.25 metros ahí.",
    });
    expect(await getStockTotals(actor, [screws, cable])).toEqual({
      [screws]: "395",
      [cable]: "197.25",
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("can leave in boxes or in another unit, with the content of that moment", async () => {
    const actor = await company();
    const screws = await product(actor, { name: "Tuerca" });
    const box = await createPresentation(actor, screws, {
      name: "Caja",
      factor: "100",
    });
    if (!box.ok) throw new Error("presentation setup failed");
    await registerEntry(actor, { productId: screws, quantity: "300" });
    expect(
      await registerExit(actor, {
        productId: screws,
        quantity: "2",
        presentationId: box.presentationId,
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Salieron 200 piezas de Tuerca de General (2 cajas × 100 = 200 piezas). Quedan 100 piezas ahí.",
    });
    // Two more boxes would be 200 pieces: only 100 are left.
    expect(
      await registerExit(actor, {
        productId: screws,
        quantity: "2",
        presentationId: box.presentationId,
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        quantity: "Solo hay 100 piezas en General: no pueden salir 200 piezas.",
      },
    });
    expect(
      await registerExit(actor, {
        productId: screws,
        quantity: "2",
        unitCode: "dozen",
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Salieron 24 piezas de Tuerca de General (2 docenas = 24 piezas). Quedan 76 piezas ahí.",
    });
    const lines = await forOrganization(
      actor.organizationId,
    ).stockMovementLine.findMany({
      where: { productId: screws, direction: "OUT" },
      orderBy: { id: "asc" },
      include: { presentationVersion: true },
    });
    expect(
      lines.map((l) => [
        l.capturedQuantity.toString(),
        l.presentationVersion?.version ?? l.capturedUnitCode,
        l.factor.toString(),
        l.baseQuantity.toString(),
      ]),
    ).toEqual([
      ["2", 1, "100", "200"],
      ["2", "dozen", "12", "24"],
    ]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("validates like an entry and writes nothing when refused", async () => {
    const actor = await company();
    const screws = await product(actor, { name: "Ancla" });
    const cable = await product(actor, {
      name: "Alambre",
      unit: "m",
      step: "0.1",
    });
    await registerEntry(actor, { productId: screws, quantity: "50" });
    await registerEntry(actor, { productId: cable, quantity: "10" });
    const archived = await product(actor, { name: "Viejo" });
    await archiveProduct(actor, archived);
    const before = await movements(actor);
    for (const [input, expected] of [
      [
        { productId: screws, quantity: "" },
        { fieldErrors: { quantity: "Escribe la cantidad que sale." } },
      ],
      [{ productId: screws, quantity: "0" }, { reason: "invalid" }],
      [{ productId: screws, quantity: "-5" }, { reason: "invalid" }],
      [{ productId: screws, quantity: "1.5" }, { reason: "invalid" }],
      [{ productId: cable, quantity: "0.25" }, { reason: "invalid" }],
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
              "Este producto está archivado. Reactívalo para registrar salidas.",
          },
        },
      ],
    ] as const) {
      expect(
        await registerExit(actor, input),
        JSON.stringify(input),
      ).toMatchObject({ ok: false, ...expected });
    }
    expect(await movements(actor)).toBe(before);
    expect(await getStockTotals(actor, [screws, cable])).toEqual({
      [screws]: "50",
      [cable]: "10",
    });
  });

  it("is for Almacén and Administrador, with the plan in force, in their own company", async () => {
    const owner = await company();
    const other = await company();
    const productId = await product(owner, { name: "Rondana" });
    await registerEntry(owner, { productId, quantity: "100" });
    for (const role of ["warehouse", "administrator"] as const) {
      const person = await member(owner.organizationId, role);
      expect(
        (await registerExit(person, { productId, quantity: "10" })).ok,
        role,
      ).toBe(true);
    }
    for (const role of ["buyer", "viewer"] as const) {
      const person = await member(owner.organizationId, role);
      await expect(
        registerExit(person, { productId, quantity: "10" }),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
    // Another company: the product does not exist for them (NEG-12).
    expect(
      await registerExit(other, { productId, quantity: "10" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    await expect(
      registerExit(
        { organizationId: owner.organizationId, userId: other.userId },
        { productId, quantity: "10" },
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await db.entitlement.updateMany({
      where: { organizationId: owner.organizationId },
      data: {
        validFrom: new Date(Date.now() - 2 * 86_400_000),
        validUntil: new Date(Date.now() - 86_400_000),
      },
    });
    invalidateEntitlements(owner.organizationId);
    await expect(
      registerExit(owner, { productId, quantity: "10" }),
    ).rejects.toMatchObject({ code: "module_read_only" });
    expect(await getStockTotals(owner, [productId])).toEqual({
      [productId]: "80",
    });
    expect(await reconcileStock(owner.organizationId)).toEqual([]);
  });
});
