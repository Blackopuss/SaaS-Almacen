import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockTotals,
  reconcileStock,
  registerEntry,
  registerExit,
  registerInitialBalance,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { createPresentation, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-21: an idempotency key in confirmations. Retrying does not duplicate
// the movement (MOV-02).

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `idem.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de reintentos",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function product(owner: InventoryActor, name = "Tornillo") {
  const result = await createProduct(owner, { sku: `I-${++counter}`, name });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

const key = () => newId();

const movements = (owner: InventoryActor) =>
  db.stockMovement.count({ where: { organizationId: owner.organizationId } });

const stock = async (owner: InventoryActor, productId: string) =>
  (await getStockTotals(owner, [productId]))[productId] ?? "0";

let actor: InventoryActor;

beforeAll(async () => {
  actor = await company();
});

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("retrying a confirmation", () => {
  it("an entry sent twice with the same key is registered once", async () => {
    const tornillo = await product(actor);
    const before = await movements(actor);
    const request = {
      productId: tornillo,
      quantity: "25",
      idempotencyKey: key(),
    };
    const first = await registerEntry(actor, request);
    const second = await registerEntry(actor, request);
    if (!first.ok || !second.ok) throw new Error("expected ok");

    expect(second.movementId).toBe(first.movementId);
    expect(first.repeated).toBeUndefined();
    expect(second.repeated).toBe(true);
    expect(second.summary).toBe(
      "Este movimiento ya estaba registrado: entraron 25 piezas de Tornillo a General. No se registró de nuevo.",
    );
    expect(await movements(actor)).toBe(before + 1);
    expect(await stock(actor, tornillo)).toBe("25");
  });

  it("an exit retried after it took the last units still answers ok, without taking more", async () => {
    const tornillo = await product(actor);
    await registerEntry(actor, { productId: tornillo, quantity: "10" });
    const request = {
      productId: tornillo,
      quantity: "10",
      idempotencyKey: key(),
    };
    const first = await registerExit(actor, request);
    // Without the key this retry would fail: nothing is left.
    const retry = await registerExit(actor, request);
    expect(first).toMatchObject({ ok: true });
    expect(retry).toMatchObject({
      ok: true,
      repeated: true,
      summary: expect.stringContaining("salieron 10 piezas de Tornillo"),
    });
    expect(await stock(actor, tornillo)).toBe("0");
    expect(
      await registerExit(actor, { productId: tornillo, quantity: "10" }),
    ).toMatchObject({ ok: false });
  });

  it("an initial balance retried is not refused as «already captured»", async () => {
    const tornillo = await product(actor);
    const request = {
      productId: tornillo,
      quantity: "300",
      idempotencyKey: key(),
    };
    await registerInitialBalance(actor, request);
    expect(await registerInitialBalance(actor, request)).toMatchObject({
      ok: true,
      repeated: true,
    });
    expect(await stock(actor, tornillo)).toBe("300");
  });

  it("ten simultaneous sends of one confirmation write one movement", async () => {
    const tornillo = await product(actor);
    const before = await movements(actor);
    const request = {
      productId: tornillo,
      quantity: "7",
      idempotencyKey: key(),
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => registerEntry(actor, request)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r.ok ? r.movementId : ""))).size).toBe(
      1,
    );
    expect(results.filter((r) => r.ok && !r.repeated)).toHaveLength(1);
    expect(await movements(actor)).toBe(before + 1);
    expect(await stock(actor, tornillo)).toBe("7");
  });

  it("works with presentations and keeps the version used the first time", async () => {
    const tornillo = await product(actor);
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    const request = {
      productId: tornillo,
      quantity: "3",
      presentationId: caja.presentationId,
      idempotencyKey: key(),
    };
    await registerEntry(actor, request);
    expect(await registerEntry(actor, request)).toMatchObject({
      ok: true,
      repeated: true,
      summary: expect.stringContaining("entraron 300 piezas"),
    });
    expect(await stock(actor, tornillo)).toBe("300");
  });

  it("the quantity may be typed differently in the retry (1,250 = 1250)", async () => {
    const tornillo = await product(actor);
    const idempotencyKey = key();
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "1,250",
      idempotencyKey,
    });
    expect(
      await registerEntry(actor, {
        productId: tornillo,
        quantity: " 1250.0 ",
        idempotencyKey,
      }),
    ).toMatchObject({ ok: true, repeated: true });
    expect(await stock(actor, tornillo)).toBe("1250");
  });
});

describe("a key is for one confirmation", () => {
  it("a different key registers another movement", async () => {
    const tornillo = await product(actor);
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "5",
      idempotencyKey: key(),
    });
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "5",
      idempotencyKey: key(),
    });
    expect(await stock(actor, tornillo)).toBe("10");
  });

  it("without a key every send is a new movement", async () => {
    const tornillo = await product(actor);
    await registerEntry(actor, { productId: tornillo, quantity: "5" });
    await registerEntry(actor, { productId: tornillo, quantity: "5" });
    expect(await stock(actor, tornillo)).toBe("10");
  });

  it("a rejected confirmation does not use up its key", async () => {
    const tornillo = await product(actor);
    await registerEntry(actor, { productId: tornillo, quantity: "5" });
    const idempotencyKey = key();
    expect(
      await registerExit(actor, {
        productId: tornillo,
        quantity: "8",
        idempotencyKey,
      }),
    ).toMatchObject({ ok: false });
    // Corrected in the same form, with the same key.
    expect(
      await registerExit(actor, {
        productId: tornillo,
        quantity: "3",
        idempotencyKey,
      }),
    ).toMatchObject({ ok: true });
    expect(await stock(actor, tornillo)).toBe("2");
  });

  it("reusing a key for something else is refused and writes nothing", async () => {
    const tornillo = await product(actor);
    const clavo = await product(actor, "Clavo");
    const shelf = await createLocation(actor, { kind: "SHELF", name: "E1" });
    if (!shelf.ok) throw new Error("location setup failed");
    const idempotencyKey = key();
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "5",
      idempotencyKey,
    });
    const before = await movements(actor);
    const refusal = {
      ok: false,
      reason: "not_allowed",
      formError: expect.stringContaining("ya se usó para otro movimiento"),
    };
    for (const other of [
      { productId: tornillo, quantity: "6" },
      { productId: clavo, quantity: "5" },
      { productId: tornillo, quantity: "5", locationId: shelf.locationId },
      { productId: tornillo, quantity: "5", unitCode: "dozen" },
    ]) {
      expect(
        await registerEntry(actor, { ...other, idempotencyKey }),
      ).toMatchObject(refusal);
    }
    // The same key as an exit, or sent by another person.
    expect(
      await registerExit(actor, {
        productId: tornillo,
        quantity: "5",
        idempotencyKey,
      }),
    ).toMatchObject(refusal);
    expect(await movements(actor)).toBe(before);
    expect(await stock(actor, tornillo)).toBe("5");
    expect(await stock(actor, clavo)).toBe("0");
  });

  it("the same key at once for two products writes one movement", async () => {
    const a = await product(actor);
    const b = await product(actor, "Clavo");
    const idempotencyKey = key();
    const results = await Promise.all([
      registerEntry(actor, { productId: a, quantity: "5", idempotencyKey }),
      registerEntry(actor, { productId: b, quantity: "5", idempotencyKey }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      reason: "not_allowed",
    });
    expect(Number(await stock(actor, a)) + Number(await stock(actor, b))).toBe(
      5,
    );
  });

  it("keys belong to a company: another company can use the same text", async () => {
    const theirs = await company();
    const mine = await product(actor);
    const other = await product(theirs);
    const idempotencyKey = key();
    expect(
      await registerEntry(actor, {
        productId: mine,
        quantity: "5",
        idempotencyKey,
      }),
    ).toMatchObject({ ok: true });
    const result = await registerEntry(theirs, {
      productId: other,
      quantity: "9",
      idempotencyKey,
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.repeated).toBeUndefined();
    expect(await stock(theirs, other)).toBe("9");
  });

  it.each(["corta", "con espacios dentro", "x".repeat(65), "ñandú-ñandú"])(
    "rejects the malformed key %j",
    async (idempotencyKey) => {
      const tornillo = await product(actor);
      expect(
        await registerEntry(actor, {
          productId: tornillo,
          quantity: "5",
          idempotencyKey,
        }),
      ).toMatchObject({
        ok: false,
        reason: "invalid",
        formError: expect.stringContaining("Recarga la página"),
      });
      expect(await stock(actor, tornillo)).toBe("0");
    },
  );
});

describe("after all of it", () => {
  it("balances still match the history", async () => {
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});
