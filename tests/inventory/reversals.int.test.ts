import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  getStockTotals,
  listRecentMovements,
  reconcileStock,
  registerAdjustment,
  registerEntry,
  registerExit,
  registerInitialBalance,
  registerTransfer,
  reverseMovement,
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

// INV-25: traceable reversal. It uses the original factor; the case
// 300 → 275 → 395 passes (UNI-02).

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `reversa.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de reversas",
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
    sku: `V-${++counter}`,
    name,
    ...(unit ? { unit } : {}),
  });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

const REASON = "Se capturó por error";

/** Runs a movement and returns its id. */
async function done(
  promise: Promise<{ ok: boolean; movementId?: string }>,
): Promise<string> {
  const result = await promise;
  if (!result.ok || !result.movementId) {
    throw new Error(`movement failed: ${JSON.stringify(result)}`);
  }
  return result.movementId;
}

const total = async (owner: InventoryActor, productId: string) =>
  (await getStockTotals(owner, [productId]))[productId] ?? "0";

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

describe("the required case (UNI-02)", () => {
  it("300 → 275 → 395; reversing the new entry subtracts 120 and the history still shows 300", async () => {
    const tornillo = await product(actor);
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");

    const first = await done(
      registerEntry(actor, {
        productId: tornillo,
        quantity: "3",
        presentationId: caja.presentationId,
      }),
    );
    expect(await total(actor, tornillo)).toBe("300");
    await done(registerExit(actor, { productId: tornillo, quantity: "25" }));
    expect(await total(actor, tornillo)).toBe("275");

    await changePresentationFactor(actor, caja.presentationId, {
      factor: "120",
    });
    const second = await done(
      registerEntry(actor, {
        productId: tornillo,
        quantity: "1",
        presentationId: caja.presentationId,
      }),
    );
    expect(await total(actor, tornillo)).toBe("395");

    // The history of the first entry still says 300, with boxes of 100.
    const [original] = await listRecentMovements(actor, { movementId: first });
    expect(original?.lines[0]).toMatchObject({
      quantity: "300 piezas",
      captured: "3 cajas de 100",
    });

    // Reversing the new entry subtracts its 120.
    const reversal = await reverseMovement(actor, {
      movementId: second,
      reason: REASON,
    });
    expect(reversal).toMatchObject({
      ok: true,
      summary: "Entrada reversada: salieron 120 piezas de Tornillo de General.",
    });
    expect(await total(actor, tornillo)).toBe("275");
  });

  it("reversing the OLD entry uses its original content (100), not today's (120)", async () => {
    const tornillo = await product(actor);
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    const first = await done(
      registerEntry(actor, {
        productId: tornillo,
        quantity: "3",
        presentationId: caja.presentationId,
      }),
    );
    await changePresentationFactor(actor, caja.presentationId, {
      factor: "120",
    });
    await done(registerEntry(actor, { productId: tornillo, quantity: "50" }));

    const reversal = await reverseMovement(actor, {
      movementId: first,
      reason: REASON,
    });
    if (!reversal.ok) throw new Error(reversal.error);
    // 300 + 50 − 300 = 50; with today's content it would have been −10.
    expect(await total(actor, tornillo)).toBe("50");

    const line = await db.stockMovementLine.findFirstOrThrow({
      where: { movementId: reversal.movementId },
      include: { presentationVersion: true },
    });
    expect(line.direction).toBe("OUT");
    expect(line.capturedQuantity.toString()).toBe("3");
    expect(line.factor.toString()).toBe("100");
    expect(line.baseQuantity.toString()).toBe("300");
    expect(line.presentationVersion?.version).toBe(1);
  });
});

describe("reverseMovement", () => {
  it("undoes each kind of movement", async () => {
    const tornillo = await product(actor);
    const shelf = await createLocation(actor, {
      kind: "SHELF",
      name: `Estante ${++counter}`,
    });
    if (!shelf.ok) throw new Error("location setup failed");

    await done(registerEntry(actor, { productId: tornillo, quantity: "100" }));

    const exit = await done(
      registerExit(actor, { productId: tornillo, quantity: "30" }),
    );
    expect(
      await reverseMovement(actor, { movementId: exit, reason: REASON }),
    ).toMatchObject({
      ok: true,
      summary: "Salida reversada: volvieron 30 piezas de Tornillo a General.",
    });
    expect(await total(actor, tornillo)).toBe("100");

    const transfer = await done(
      registerTransfer(actor, {
        productId: tornillo,
        locationId: general,
        toLocationId: shelf.locationId,
        quantity: "40",
      }),
    );
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [general]: "60",
      [shelf.locationId]: "40",
    });
    expect(
      await reverseMovement(actor, { movementId: transfer, reason: REASON }),
    ).toMatchObject({ ok: true });
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [general]: "100",
    });

    const adjustment = await done(
      registerAdjustment(actor, {
        productId: tornillo,
        quantity: "90",
        reason: "Conteo equivocado",
      }),
    );
    expect(
      await reverseMovement(actor, { movementId: adjustment, reason: REASON }),
    ).toMatchObject({
      ok: true,
      summary: "Ajuste reversado: volvieron 10 piezas de Tornillo a General.",
    });
    expect(await total(actor, tornillo)).toBe("100");

    const other = await product(actor, "Clavo");
    const initial = await done(
      registerInitialBalance(actor, { productId: other, quantity: "500" }),
    );
    expect(
      await reverseMovement(actor, { movementId: initial, reason: REASON }),
    ).toMatchObject({ ok: true });
    expect(await total(actor, other)).toBe("0");
  });

  it("keeps the original untouched and links both movements", async () => {
    const tornillo = await product(actor);
    const entry = await done(
      registerEntry(actor, { productId: tornillo, quantity: "10" }),
    );
    const reversal = await reverseMovement(actor, {
      movementId: entry,
      reason: "  Era otro producto  ",
    });
    if (!reversal.ok) throw new Error(reversal.error);

    const [original] = await listRecentMovements(actor, { movementId: entry });
    expect(original).toMatchObject({
      type: "ENTRY",
      reversedByMovementId: reversal.movementId,
      reversesMovementId: null,
    });
    const [undo] = await listRecentMovements(actor, {
      movementId: reversal.movementId,
    });
    expect(undo).toMatchObject({
      type: "REVERSAL",
      typeLabel: "Reversa",
      reason: "Era otro producto",
      reversesMovementId: entry,
      reversedByMovementId: null,
    });
    expect(
      await db.auditEvent.findFirstOrThrow({
        where: {
          organizationId: actor.organizationId,
          action: "inventory.reversed",
          targetId: entry,
        },
      }),
    ).toMatchObject({
      actorUserId: actor.userId,
      reason: "Era otro producto",
      metadata: { tipo: "Entrada", movementId: reversal.movementId },
    });
  });

  it("keeps decimals exact", async () => {
    const cable = await product(actor, "Cable", "m");
    await done(registerEntry(actor, { productId: cable, quantity: "200" }));
    const cut = await done(
      registerExit(actor, { productId: cable, quantity: "2.75" }),
    );
    expect(await total(actor, cable)).toBe("197.25");
    await reverseMovement(actor, { movementId: cut, reason: REASON });
    expect(await total(actor, cable)).toBe("200");
  });
});

describe("what a reversal refuses", () => {
  it("a movement is reversed at most once, even with simultaneous requests", async () => {
    const tornillo = await product(actor);
    await done(registerEntry(actor, { productId: tornillo, quantity: "100" }));
    const exit = await done(
      registerExit(actor, { productId: tornillo, quantity: "10" }),
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        reverseMovement(actor, { movementId: exit, reason: REASON }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      reason: "not_allowed",
      error: "Este movimiento ya fue reversado.",
    });
    expect(await total(actor, tornillo)).toBe("100");
  });

  it("a reversal cannot be reversed", async () => {
    const tornillo = await product(actor);
    const entry = await done(
      registerEntry(actor, { productId: tornillo, quantity: "10" }),
    );
    const reversal = await reverseMovement(actor, {
      movementId: entry,
      reason: REASON,
    });
    if (!reversal.ok) throw new Error(reversal.error);
    expect(
      await reverseMovement(actor, {
        movementId: reversal.movementId,
        reason: REASON,
      }),
    ).toMatchObject({
      ok: false,
      reason: "not_allowed",
      error: expect.stringContaining("Una reversa no se puede reversar"),
    });
  });

  it("an entry whose stock already left: nothing goes below zero", async () => {
    const tornillo = await product(actor);
    const entry = await done(
      registerEntry(actor, { productId: tornillo, quantity: "100" }),
    );
    await done(registerExit(actor, { productId: tornillo, quantity: "30" }));
    expect(
      await reverseMovement(actor, { movementId: entry, reason: REASON }),
    ).toEqual({
      ok: false,
      reason: "invalid",
      error:
        "No se puede reversar: habría que sacar 100 piezas de Tornillo de General y solo hay 70 piezas. Parte de esas existencias ya salió o se movió.",
    });
    expect(await total(actor, tornillo)).toBe("70");
    expect(
      await db.stockMovement.count({
        where: { reversesMovementId: entry },
      }),
    ).toBe(0);
  });

  it.each(["", "  ", "no", "abcd"])(
    "the reason %j: it is mandatory",
    async (reason) => {
      const tornillo = await product(actor);
      const entry = await done(
        registerEntry(actor, { productId: tornillo, quantity: "10" }),
      );
      expect(
        await reverseMovement(actor, { movementId: entry, reason }),
      ).toMatchObject({
        ok: false,
        reason: "invalid",
        error: expect.stringContaining("Escribe por qué se reversa"),
      });
      expect(await total(actor, tornillo)).toBe("10");
    },
  );

  it("the database refuses a reversal without a reason, even with SQL", async () => {
    const tornillo = await product(actor);
    const entry = await done(
      registerEntry(actor, { productId: tornillo, quantity: "10" }),
    );
    await expect(
      db.$executeRaw`INSERT INTO stock_movement (id, organizationId, type, reason, reversesMovementId, createdByUserId) VALUES (${newId()}, ${actor.organizationId}, 'REVERSAL', NULL, ${entry}, ${actor.userId})`,
    ).rejects.toThrow(/stock_movement_reversal_reason_check/);
  });

  it("movements of another company, unknown ids, and people without the permission", async () => {
    const theirs = await company();
    const tornillo = await product(actor);
    const entry = await done(
      registerEntry(actor, { productId: tornillo, quantity: "10" }),
    );
    for (const movementId of [entry, newId()]) {
      expect(
        await reverseMovement(theirs, { movementId, reason: REASON }),
      ).toMatchObject({ ok: false, reason: "not_found" });
    }
    for (const role of ["buyer", "viewer"] as const) {
      const other = await member(actor.organizationId, role);
      await expect(
        reverseMovement(other, { movementId: entry, reason: REASON }),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
    expect(await total(actor, tornillo)).toBe("10");
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(
      await reverseMovement(warehouse, { movementId: entry, reason: REASON }),
    ).toMatchObject({ ok: true });
  });

  it("a retried reversal with its key is applied once", async () => {
    const tornillo = await product(actor);
    const entry = await done(
      registerEntry(actor, { productId: tornillo, quantity: "10" }),
    );
    const request = {
      movementId: entry,
      reason: REASON,
      idempotencyKey: newId(),
    };
    const first = await reverseMovement(actor, request);
    const retry = await reverseMovement(actor, request);
    expect(first).toMatchObject({ ok: true });
    expect(retry).toMatchObject({ ok: true, repeated: true });
    expect(retry.ok && first.ok && retry.movementId).toBe(
      first.ok && first.movementId,
    );
    expect(await total(actor, tornillo)).toBe("0");
  });
});

describe("after all of it", () => {
  it("balances still match the history", async () => {
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});
