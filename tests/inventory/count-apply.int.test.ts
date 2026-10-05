import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  applyCount,
  cancelCount,
  captureCount,
  getCount,
  getStockByLocation,
  listMovements,
  openCount,
  reconcileStock,
  registerEntry,
  registerExit,
  removeCapture,
  reverseMovement,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-33: applying a count writes its differences as one adjustment, once.

const stamp = Date.now();
let counter = 0;
let staff = "";
const REASON = "Conteo de cierre de mes";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `aplicar.${++counter}.${stamp}@example.test`,
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
      productLimit: 300,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de aplicar conteos",
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

async function shelf(owner: InventoryActor) {
  const result = await createLocation(owner, {
    kind: "SHELF",
    name: `Estante ${++counter}`,
  });
  if (!result.ok) throw new Error("location setup failed");
  return result.locationId;
}

/**
 * A shelf with products (name → stock in the system) and an open count
 * with what was found of each (name → counted; missing = not counted).
 */
async function scene(
  owner: InventoryActor,
  system: Record<string, string>,
  counted: Record<string, string>,
) {
  const locationId = await shelf(owner);
  const products: Record<string, string> = {};
  for (const [name, quantity] of Object.entries(system)) {
    const created = await createProduct(owner, {
      sku: `A-${++counter}`,
      name,
    });
    if (!created.ok) throw new Error("product setup failed");
    products[name] = created.productId;
    if (quantity !== "0") {
      await registerEntry(owner, {
        productId: created.productId,
        locationId,
        quantity,
      });
    }
  }
  const opened = await openCount(owner, { locationId });
  if (!opened.ok) throw new Error("count setup failed");
  for (const [name, quantity] of Object.entries(counted)) {
    const capture = await captureCount(owner, {
      countId: opened.countId,
      productId: products[name]!,
      quantity,
    });
    if (!capture.ok) throw new Error("capture failed");
  }
  const stock = async (name: string) =>
    (await getStockByLocation(owner, products[name]!))[locationId] ?? "0";
  return { countId: opened.countId, locationId, products, stock };
}

const adjustments = async (owner: InventoryActor) =>
  (await listMovements(owner, { type: "ADJUSTMENT" })).total;

let actor: InventoryActor;

beforeAll(async () => {
  actor = await company();
}, 60_000);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("applyCount", () => {
  it("writes every difference as one adjustment and closes the count", async () => {
    const { countId, locationId, products, stock } = await scene(
      actor,
      { Tornillo: "40", Clavo: "10", Lija: "5", Broca: "0" },
      { Tornillo: "38", Clavo: "13", Lija: "5", Broca: "2" },
    );
    const result = await applyCount(actor, { countId, reason: REASON });
    expect(result).toMatchObject({
      ok: true,
      adjusted: 3,
      summary: "Conteo aplicado: se ajustaron 3 productos.",
    });
    if (!result.ok) return;
    expect(await stock("Tornillo")).toBe("38");
    expect(await stock("Clavo")).toBe("13");
    expect(await stock("Lija")).toBe("5");
    expect(await stock("Broca")).toBe("2");

    const movement = await db.stockMovement.findUniqueOrThrow({
      where: { id: result.movementId! },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(movement).toMatchObject({
      type: "ADJUSTMENT",
      reason: REASON,
      createdByUserId: actor.userId,
    });
    expect(movement.reference).toContain("Conteo de Estante");
    expect(
      movement.lines.map((line) => [
        line.productId,
        line.locationId,
        line.direction,
        line.baseQuantity.toString(),
      ]),
    ).toEqual([
      [products.Tornillo, locationId, "OUT", "2"],
      [products.Clavo, locationId, "IN", "3"],
      [products.Broca, locationId, "IN", "2"],
    ]);

    const count = await getCount(actor, countId);
    expect(count).toMatchObject({
      status: "APPLIED",
      statusLabel: "Aplicado",
      appliedMovementId: result.movementId,
    });
    expect(count!.closedAt).toBeInstanceOf(Date);
    const audit = await db.auditEvent.findFirst({
      where: {
        organizationId: actor.organizationId,
        action: "inventory.count_applied",
        targetId: countId,
      },
    });
    expect(audit).toMatchObject({ actorUserId: actor.userId, reason: REASON });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("applying twice adjusts once", async () => {
    const { countId, stock } = await scene(
      actor,
      { Tornillo: "40" },
      { Tornillo: "35" },
    );
    const before = await adjustments(actor);
    const first = await applyCount(actor, { countId, reason: REASON });
    const again = await applyCount(actor, { countId, reason: "Otra vez" });
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again).toMatchObject({
      movementId: first.movementId,
      adjusted: 1,
      repeated: true,
    });
    expect(await stock("Tornillo")).toBe("35");
    expect(await adjustments(actor)).toBe(before + 1);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("two people applying at once adjust once", async () => {
    const { countId, stock } = await scene(
      actor,
      { Tornillo: "40", Clavo: "40" },
      { Tornillo: "30", Clavo: "45" },
    );
    const before = await adjustments(actor);
    const results = await Promise.all([
      applyCount(actor, { countId, reason: REASON }),
      applyCount(actor, { countId, reason: REASON }),
      applyCount(actor, { countId, reason: REASON }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      results.filter((result) => result.ok && !result.repeated),
    ).toHaveLength(1);
    expect(await stock("Tornillo")).toBe("30");
    expect(await stock("Clavo")).toBe("45");
    expect(await adjustments(actor)).toBe(before + 1);
    expect(
      await db.stockMovement.count({
        where: { idempotencyKey: `count-${countId}` },
      }),
    ).toBe(1);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("respects what moved after counting", async () => {
    const { countId, locationId, products, stock } = await scene(
      actor,
      { Tornillo: "40", Clavo: "10" },
      { Tornillo: "38", Clavo: "10" },
    );
    // Sold after being counted: those 5 were among the 38 that were seen.
    await registerExit(actor, {
      productId: products.Tornillo!,
      locationId,
      quantity: "5",
    });
    // Arrived after being counted, in a product that matched.
    await registerEntry(actor, {
      productId: products.Clavo!,
      locationId,
      quantity: "7",
    });
    const result = await applyCount(actor, { countId, reason: REASON });
    expect(result).toMatchObject({ ok: true, adjusted: 1 });
    // 35 − 2 missing = 33, not the 38 counted; the arrival stays.
    expect(await stock("Tornillo")).toBe("33");
    expect(await stock("Clavo")).toBe("17");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("refuses to apply while a difference no longer fits", async () => {
    const { countId, locationId, products, stock } = await scene(
      actor,
      { Tornillo: "40", Clavo: "10" },
      { Tornillo: "3", Clavo: "8" },
    );
    await registerExit(actor, {
      productId: products.Tornillo!,
      locationId,
      quantity: "10",
    });
    const before = await adjustments(actor);
    const refused = await applyCount(actor, { countId, reason: REASON });
    expect(refused).toMatchObject({
      ok: false,
      reason: "not_allowed",
      conflicts: ["Tornillo"],
    });
    // Nothing was applied, not even the product that had no conflict.
    expect(await stock("Clavo")).toBe("10");
    expect(await adjustments(actor)).toBe(before);
    expect((await getCount(actor, countId))!.status).toBe("OPEN");

    // Counted again, it applies.
    const count = await getCount(actor, countId);
    const line = count!.lines.find((l) => l.name === "Tornillo")!;
    for (const capture of line.captures) {
      await removeCapture(actor, { countId, captureId: capture.id });
    }
    await captureCount(actor, {
      countId,
      productId: products.Tornillo!,
      quantity: "29",
    });
    expect(await applyCount(actor, { countId, reason: REASON })).toMatchObject({
      ok: true,
      adjusted: 2,
    });
    expect(await stock("Tornillo")).toBe("29");
    expect(await stock("Clavo")).toBe("8");
  });

  it("with nothing different it closes without an adjustment", async () => {
    const { countId, stock } = await scene(
      actor,
      { Tornillo: "40" },
      { Tornillo: "40" },
    );
    const before = await adjustments(actor);
    expect(await applyCount(actor, { countId, reason: REASON })).toEqual({
      ok: true,
      movementId: null,
      adjusted: 0,
      summary: "Conteo aplicado: todo coincidía, no hubo nada que ajustar.",
    });
    expect(await adjustments(actor)).toBe(before);
    expect(await stock("Tornillo")).toBe("40");
    expect(await getCount(actor, countId)).toMatchObject({
      status: "APPLIED",
      appliedMovementId: null,
    });
    expect(await applyCount(actor, { countId, reason: REASON })).toMatchObject({
      ok: true,
      repeated: true,
      adjusted: 0,
    });
  });

  it("products that were not counted are left alone", async () => {
    const { countId, stock } = await scene(
      actor,
      { Tornillo: "40", Olvidado: "9" },
      { Tornillo: "41" },
    );
    await applyCount(actor, { countId, reason: REASON });
    expect(await stock("Tornillo")).toBe("41");
    expect(await stock("Olvidado")).toBe("9");
  });

  it("asks for a reason and for something counted", async () => {
    const { countId, stock } = await scene(
      actor,
      { Tornillo: "40" },
      { Tornillo: "39" },
    );
    for (const reason of ["", "ok", "   "]) {
      expect(await applyCount(actor, { countId, reason })).toMatchObject({
        ok: false,
        reason: "invalid",
        field: "reason",
      });
    }
    const empty = await scene(actor, { Tornillo: "40" }, {});
    expect(
      await applyCount(actor, { countId: empty.countId, reason: REASON }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await stock("Tornillo")).toBe("40");
  });

  it("an applied count admits no changes, and a cancelled one is not applied", async () => {
    const { countId, products } = await scene(
      actor,
      { Tornillo: "40" },
      { Tornillo: "39" },
    );
    await applyCount(actor, { countId, reason: REASON });
    expect(
      await captureCount(actor, {
        countId,
        productId: products.Tornillo!,
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await cancelCount(actor, countId)).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });

    const cancelled = await scene(actor, { Tornillo: "40" }, { Tornillo: "1" });
    await cancelCount(actor, cancelled.countId);
    expect(
      await applyCount(actor, { countId: cancelled.countId, reason: REASON }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await cancelled.stock("Tornillo")).toBe("40");
  });

  it("the location is free for a new count after applying", async () => {
    const { countId, locationId } = await scene(
      actor,
      { Tornillo: "40" },
      { Tornillo: "39" },
    );
    await applyCount(actor, { countId, reason: REASON });
    expect((await openCount(actor, { locationId })).ok).toBe(true);
  });

  it("the adjustment of a count can be reversed like any other", async () => {
    const { countId, stock } = await scene(
      actor,
      { Tornillo: "40", Clavo: "10" },
      { Tornillo: "38", Clavo: "12" },
    );
    const applied = await applyCount(actor, { countId, reason: REASON });
    if (!applied.ok || !applied.movementId) throw new Error("apply failed");
    const reversal = await reverseMovement(actor, {
      movementId: applied.movementId,
      reason: "El conteo se hizo en el estante equivocado",
    });
    expect(reversal.ok).toBe(true);
    expect(await stock("Tornillo")).toBe("40");
    expect(await stock("Clavo")).toBe("10");
    // Applying again still does nothing.
    expect(await applyCount(actor, { countId, reason: REASON })).toMatchObject({
      ok: true,
      repeated: true,
    });
    expect(await stock("Tornillo")).toBe("40");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("handles a long count in one go", async () => {
    const system: Record<string, string> = {};
    const counted: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      system[`Producto ${i}`] = "10";
      counted[`Producto ${i}`] = i % 2 === 0 ? "9" : "12";
    }
    const { countId, stock } = await scene(actor, system, counted);
    expect(await applyCount(actor, { countId, reason: REASON })).toMatchObject({
      ok: true,
      adjusted: 60,
    });
    expect(await stock("Producto 0")).toBe("9");
    expect(await stock("Producto 59")).toBe("12");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 180_000);
});

describe("who and which company", () => {
  it("only who may apply counts and adjust stock", async () => {
    const { countId, stock } = await scene(
      actor,
      { Tornillo: "40" },
      { Tornillo: "39" },
    );
    const denied = { code: "permission_denied" };
    for (const role of ["viewer", "buyer"] as const) {
      const person = await member(actor.organizationId, role);
      await expect(
        applyCount(person, { countId, reason: REASON }),
      ).rejects.toMatchObject(denied);
    }
    expect(await stock("Tornillo")).toBe("40");
    const warehouse = await member(actor.organizationId, "warehouse");
    expect((await applyCount(warehouse, { countId, reason: REASON })).ok).toBe(
      true,
    );
    expect(await stock("Tornillo")).toBe("39");
  });

  it("another company cannot apply this one's count", async () => {
    const { countId, stock } = await scene(
      actor,
      { Tornillo: "40" },
      { Tornillo: "39" },
    );
    const theirs = await company();
    expect(await applyCount(theirs, { countId, reason: REASON })).toMatchObject(
      { ok: false, reason: "not_found" },
    );
    expect(await stock("Tornillo")).toBe("40");
    expect((await getCount(actor, countId))!.status).toBe("OPEN");
  });
});
