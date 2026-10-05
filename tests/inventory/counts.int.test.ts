import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  cancelCount,
  captureCount,
  getCount,
  getStockTotals,
  listCounts,
  listMovements,
  openCount,
  registerEntry,
  registerExit,
  removeCapture,
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
import { db } from "@/server";

// INV-31: physical count, capture. Boxes and pieces are normalized, the
// reference of each product is kept, and stock never changes.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser(name = "Persona") {
  const user = await db.user.create({
    data: {
      id: newId(),
      name,
      email: `conteos.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<InventoryActor> {
  const owner = await newUser("Doña Esperanza");
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
      reason: "Prueba de conteos",
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
  name: string,
  quantity = "",
  unit?: string,
) {
  const result = await createProduct(owner, {
    sku: `C-${++counter}`,
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

async function general(owner: InventoryActor) {
  const location = await getDefaultLocation(owner);
  if (!location) throw new Error("no default location");
  return location.id;
}

async function shelf(owner: InventoryActor) {
  const result = await createLocation(owner, {
    kind: "SHELF",
    name: `Estante ${++counter}`,
  });
  if (!result.ok) throw new Error("location setup failed");
  return result.locationId;
}

/** An open count of a new shelf, so tests do not share a location. */
async function countOf(owner: InventoryActor, locationId?: string) {
  const result = await openCount(owner, {
    locationId: locationId ?? (await shelf(owner)),
  });
  if (!result.ok) throw new Error("count setup failed");
  return result.countId;
}

const total = async (owner: InventoryActor, productId: string) =>
  (await getStockTotals(owner, [productId]))[productId] ?? "0";

let actor: InventoryActor;

beforeAll(async () => {
  actor = await company();
}, 60_000);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("openCount", () => {
  it("starts the count of a location, with who and when", async () => {
    const locationId = await shelf(actor);
    const before = Date.now();
    const result = await openCount(actor, {
      locationId,
      note: "  Cierre de mes ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const count = await getCount(actor, result.countId);
    expect(count).toMatchObject({
      status: "OPEN",
      statusLabel: "Abierto",
      note: "Cierre de mes",
      locationId,
      startedByName: "Doña Esperanza",
      closedAt: null,
      products: 0,
      lines: [],
    });
    expect(count!.startedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("allows one open count per location", async () => {
    const locationId = await shelf(actor);
    const first = await countOf(actor, locationId);
    const second = await openCount(actor, { locationId });
    expect(second).toMatchObject({
      ok: false,
      reason: "not_allowed",
      field: "locationId",
      openCountId: first,
    });
    // Another location is free, and so is this one once the count closes.
    expect(
      (await openCount(actor, { locationId: await shelf(actor) })).ok,
    ).toBe(true);
    await cancelCount(actor, first);
    expect((await openCount(actor, { locationId })).ok).toBe(true);
  });

  it("two people opening the same location at once get one count", async () => {
    const locationId = await shelf(actor);
    const results = await Promise.all([
      openCount(actor, { locationId }),
      openCount(actor, { locationId }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await db.stockCount.count({ where: { locationId, status: "OPEN" } }),
    ).toBe(1);
  });

  it("refuses unknown, archived or foreign locations", async () => {
    expect(await openCount(actor, { locationId: "" })).toMatchObject({
      ok: false,
      reason: "invalid",
      field: "locationId",
    });
    expect(await openCount(actor, { locationId: newId() })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    const theirs = await company();
    expect(
      await openCount(actor, { locationId: await shelf(theirs) }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    const archived = await shelf(actor);
    await db.location.update({
      where: { id: archived },
      data: { archivedAt: new Date() },
    });
    expect(await openCount(actor, { locationId: archived })).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });
  });
});

describe("captureCount", () => {
  it("normalizes boxes and pieces into the product's unit", async () => {
    const tornillo = await product(actor, "Tornillo", "250");
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    const countId = await countOf(actor, await general(actor));

    const boxes = await captureCount(actor, {
      countId,
      productId: tornillo,
      quantity: "2",
      presentationId: caja.presentationId,
    });
    expect(boxes).toMatchObject({
      ok: true,
      counted: "200",
      mixed: false,
      summary: "Tornillo: 2 cajas × 100 = 200 piezas.",
    });
    const pieces = await captureCount(actor, {
      countId,
      productId: tornillo,
      quantity: "30",
    });
    expect(pieces).toMatchObject({
      ok: true,
      counted: "230",
      // Boxes and loose pieces: worth checking nothing was counted twice.
      mixed: true,
      summary: "Tornillo: 30 piezas. Van 230 piezas contadas en 2 capturas.",
    });

    const count = await getCount(actor, countId);
    expect(count!.lines).toHaveLength(1);
    expect(count!.lines[0]).toMatchObject({
      productId: tornillo,
      name: "Tornillo",
      counted: "230",
      countedLabel: "230 piezas",
      system: "250",
      systemLabel: "250 piezas",
      difference: "-20",
      differenceLabel: "Faltan 20 piezas",
      mixed: true,
    });
    expect(count!.lines[0]!.captures.map((capture) => capture.label)).toEqual([
      "2 cajas × 100 = 200 piezas",
      "30 piezas",
    ]);
    expect(count!.differences).toBe(1);
    await cancelCount(actor, countId);
  });

  it("keeps the content the box had when it was counted", async () => {
    const clavo = await product(actor, "Clavo");
    const caja = await createPresentation(actor, clavo, {
      name: "Caja",
      factor: "50",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    const countId = await countOf(actor);
    const result = await captureCount(actor, {
      countId,
      productId: clavo,
      quantity: "3",
      presentationId: caja.presentationId,
    });
    if (!result.ok) throw new Error("capture failed");
    const stored = await db.stockCountCapture.findUniqueOrThrow({
      where: { id: result.captureId },
    });
    expect(stored.factor.toString()).toBe("50");
    expect(stored.baseQuantity.toString()).toBe("150");
    expect(stored.presentationVersionId).toBeTruthy();
    expect(stored.createdByUserId).toBe(actor.userId);
  });

  it("converts other units and accepts zero", async () => {
    const cable = await product(actor, "Cable", "", "m");
    const lija = await product(actor, "Lija");
    const countId = await countOf(actor);
    expect(
      await captureCount(actor, {
        countId,
        productId: cable,
        quantity: "275",
        unitCode: "cm",
      }),
    ).toMatchObject({ ok: true, counted: "2.75" });
    expect(
      await captureCount(actor, { countId, productId: lija, quantity: "0" }),
    ).toMatchObject({ ok: true, counted: "0", summary: "Lija: 0 piezas." });
    const count = await getCount(actor, countId);
    const byName = Object.fromEntries(
      count!.lines.map((line) => [line.name, line]),
    );
    expect(byName.Cable!.captures[0]!.label).toBe(
      "275 centímetros = 2.75 metros",
    );
    expect(byName.Cable!.differenceLabel).toBe("Sobran 2.75 metros");
    expect(byName.Lija!.differenceLabel).toBe("Coincide");
    expect(count!.differences).toBe(1);
  });

  it("keeps the reference: the moment and what the system had", async () => {
    const tornillo = await product(actor, "Tornillo con referencia");
    const locationId = await shelf(actor);
    await registerEntry(actor, {
      productId: tornillo,
      locationId,
      quantity: "40",
    });
    // Stock elsewhere is not part of this location's count.
    await registerEntry(actor, { productId: tornillo, quantity: "999" });
    const countId = await countOf(actor, locationId);
    const before = Date.now();
    await captureCount(actor, { countId, productId: tornillo, quantity: "38" });
    const first = (await getCount(actor, countId))!.lines[0]!;
    expect(first).toMatchObject({ system: "40", difference: "-2" });
    expect(first.countedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // A later movement and a second capture do not move the reference.
    await registerExit(actor, {
      productId: tornillo,
      locationId,
      quantity: "5",
    });
    await captureCount(actor, { countId, productId: tornillo, quantity: "1" });
    const again = (await getCount(actor, countId))!.lines[0]!;
    expect(again.system).toBe("40");
    expect(again.countedAt.getTime()).toBe(first.countedAt.getTime());
    expect(again.counted).toBe("39");
  });

  it("never changes stock or writes movements", async () => {
    const tornillo = await product(actor, "Tornillo intacto", "10");
    const movements = (await listMovements(actor)).total;
    const countId = await countOf(actor, await general(actor));
    await captureCount(actor, { countId, productId: tornillo, quantity: "3" });
    await captureCount(actor, { countId, productId: tornillo, quantity: "0" });
    await cancelCount(actor, countId);
    expect(await total(actor, tornillo)).toBe("10");
    expect((await listMovements(actor)).total).toBe(movements);
  });

  it("refuses what cannot be counted, next to its field", async () => {
    const tornillo = await product(actor, "Tornillo entero");
    const archived = await product(actor, "Descontinuado");
    await archiveProduct(actor, archived);
    const theirs = await company();
    const foreign = await product(theirs, "Ajeno");
    const countId = await countOf(actor);
    for (const quantity of ["", "0.5", "-2", "muchas"]) {
      expect(
        await captureCount(actor, { countId, productId: tornillo, quantity }),
      ).toMatchObject({ ok: false, field: "quantity" });
    }
    expect(
      await captureCount(actor, {
        countId,
        productId: archived,
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed", field: "productId" });
    for (const productId of [foreign, newId()]) {
      expect(
        await captureCount(actor, { countId, productId, quantity: "1" }),
      ).toMatchObject({ ok: false, reason: "not_found", field: "productId" });
    }
    expect(
      await captureCount(actor, {
        countId: newId(),
        productId: tornillo,
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect((await getCount(actor, countId))!.lines).toEqual([]);
  });

  it("captures arriving at once all count", async () => {
    const tornillo = await product(actor, "Tornillo a varias manos");
    const countId = await countOf(actor);
    const results = await Promise.all(
      ["5", "7", "11"].map((quantity) =>
        captureCount(actor, { countId, productId: tornillo, quantity }),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    const count = await getCount(actor, countId);
    expect(count!.lines).toHaveLength(1);
    expect(count!.lines[0]!.counted).toBe("23");
  }, 60_000);
});

describe("removeCapture and cancelCount", () => {
  it("takes back a capture; without captures the product is not counted", async () => {
    const tornillo = await product(actor, "Tornillo corregido");
    const countId = await countOf(actor);
    const wrong = await captureCount(actor, {
      countId,
      productId: tornillo,
      quantity: "500",
    });
    const right = await captureCount(actor, {
      countId,
      productId: tornillo,
      quantity: "50",
    });
    if (!wrong.ok || !right.ok) throw new Error("capture failed");
    expect(
      await removeCapture(actor, { countId, captureId: wrong.captureId }),
    ).toEqual({ ok: true });
    expect((await getCount(actor, countId))!.lines[0]!.counted).toBe("50");
    await removeCapture(actor, { countId, captureId: right.captureId });
    expect((await getCount(actor, countId))!.lines).toEqual([]);
    expect(
      await removeCapture(actor, { countId, captureId: right.captureId }),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("a capture is only removed through its own count", async () => {
    const tornillo = await product(actor, "Tornillo de otro conteo");
    const countId = await countOf(actor);
    const other = await countOf(actor);
    const capture = await captureCount(actor, {
      countId,
      productId: tornillo,
      quantity: "4",
    });
    if (!capture.ok) throw new Error("capture failed");
    expect(
      await removeCapture(actor, {
        countId: other,
        captureId: capture.captureId,
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect((await getCount(actor, countId))!.lines[0]!.counted).toBe("4");
  });

  it("a cancelled count keeps what it had and admits no changes", async () => {
    const tornillo = await product(actor, "Tornillo abandonado");
    const countId = await countOf(actor);
    const capture = await captureCount(actor, {
      countId,
      productId: tornillo,
      quantity: "4",
    });
    if (!capture.ok) throw new Error("capture failed");
    expect(await cancelCount(actor, countId)).toEqual({ ok: true });
    const count = await getCount(actor, countId);
    expect(count).toMatchObject({
      status: "CANCELLED",
      statusLabel: "Cancelado",
      closedByName: "Doña Esperanza",
      products: 1,
    });
    expect(count!.closedAt).toBeInstanceOf(Date);
    expect(
      await captureCount(actor, {
        countId,
        productId: tornillo,
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(
      await removeCapture(actor, { countId, captureId: capture.captureId }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await cancelCount(actor, countId)).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });
  });
});

describe("who and which company", () => {
  it("lists the company's counts, open ones first", async () => {
    const owner = await company();
    const closed = await countOf(owner);
    await cancelCount(owner, closed);
    const open = await countOf(owner);
    const later = await countOf(owner);
    await cancelCount(owner, later);
    const list = await listCounts(owner);
    expect(list.map((count) => count.id)).toEqual([open, later, closed]);
    expect(list[0]).toMatchObject({ status: "OPEN", products: 0 });
  });

  it("another company sees and touches nothing", async () => {
    const tornillo = await product(actor, "Tornillo privado");
    const countId = await countOf(actor);
    const capture = await captureCount(actor, {
      countId,
      productId: tornillo,
      quantity: "4",
    });
    if (!capture.ok) throw new Error("capture failed");
    const theirs = await company();
    const theirProduct = await product(theirs, "Suyo");
    expect(await getCount(theirs, countId)).toBeNull();
    expect((await listCounts(theirs)).map((count) => count.id)).not.toContain(
      countId,
    );
    expect(
      await captureCount(theirs, {
        countId,
        productId: theirProduct,
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await removeCapture(theirs, { countId, captureId: capture.captureId }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await cancelCount(theirs, countId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect((await getCount(actor, countId))!.status).toBe("OPEN");
  });

  it("viewers read counts but do not open, capture or cancel", async () => {
    const tornillo = await product(actor, "Tornillo de consulta");
    const countId = await countOf(actor);
    const viewer = await member(actor.organizationId, "viewer");
    expect((await getCount(viewer, countId))!.id).toBe(countId);
    const denied = { code: "permission_denied" };
    await expect(
      openCount(viewer, { locationId: await shelf(actor) }),
    ).rejects.toMatchObject(denied);
    await expect(
      captureCount(viewer, { countId, productId: tornillo, quantity: "1" }),
    ).rejects.toMatchObject(denied);
    await expect(cancelCount(viewer, countId)).rejects.toMatchObject(denied);
    // Buyers do not even read them.
    const buyer = await member(actor.organizationId, "buyer");
    await expect(getCount(buyer, countId)).rejects.toMatchObject(denied);
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(
      (
        await captureCount(warehouse, {
          countId,
          productId: tornillo,
          quantity: "1",
        })
      ).ok,
    ).toBe(true);
  });
});
