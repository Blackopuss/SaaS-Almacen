import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  getStockTotals,
  listRecentMovements,
  reconcileStock,
  registerEntry,
  registerTransfer,
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

// INV-23: atomic relocation. 120/80 → 100/100 with the total intact.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `reubica.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de reubicaciones",
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
    sku: `R-${++counter}`,
    name,
    ...(unit ? { unit } : {}),
  });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

async function shelf(owner: InventoryActor, name: string) {
  const result = await createLocation(owner, { kind: "SHELF", name });
  if (!result.ok) throw new Error("location setup failed");
  return result.locationId;
}

/** A product with 120 in shelf A and 80 in shelf B. */
async function scenario(owner: InventoryActor) {
  const tornillo = await product(owner);
  const a = await shelf(owner, `Estante A${++counter}`);
  const b = await shelf(owner, `Estante B${counter}`);
  await registerEntry(owner, {
    productId: tornillo,
    locationId: a,
    quantity: "120",
  });
  await registerEntry(owner, {
    productId: tornillo,
    locationId: b,
    quantity: "80",
  });
  return { tornillo, a, b };
}

const total = async (owner: InventoryActor, productId: string) =>
  (await getStockTotals(owner, [productId]))[productId] ?? "0";

let actor: InventoryActor;

beforeAll(async () => {
  actor = await company();
});

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("registerTransfer", () => {
  it("120/80 → 100/100 with the total intact", async () => {
    const { tornillo, a, b } = await scenario(actor);
    const result = await registerTransfer(actor, {
      productId: tornillo,
      locationId: a,
      toLocationId: b,
      quantity: "20",
      reason: "Acomodo de fin de mes",
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.summary).toMatch(
      /^Se movieron 20 piezas de Tornillo de Estante A\d+ a Estante B\d+\. Quedan 100 piezas en Estante A\d+ y hay 100 piezas en Estante B\d+\.$/,
    );
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "100",
      [b]: "100",
    });
    expect(await total(actor, tornillo)).toBe("200");
  });

  it("is one movement with two lines: what leaves and what arrives", async () => {
    const { tornillo, a, b } = await scenario(actor);
    const result = await registerTransfer(actor, {
      productId: tornillo,
      locationId: a,
      toLocationId: b,
      quantity: "20",
    });
    if (!result.ok) throw new Error("expected ok");
    const movement = await db.stockMovement.findUniqueOrThrow({
      where: { id: result.movementId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(movement.type).toBe("TRANSFER");
    expect(
      movement.lines.map((line) => [
        line.direction,
        line.locationId,
        line.baseQuantity.toString(),
      ]),
    ).toEqual([
      ["OUT", a, "20"],
      ["IN", b, "20"],
    ]);
    const [listed] = await listRecentMovements(actor, {
      movementId: result.movementId,
    });
    expect(listed?.type).toBe("TRANSFER");
    expect(listed?.lines).toHaveLength(2);
  });

  it("moves presentations with the content of their current version", async () => {
    const { tornillo, a, b } = await scenario(actor);
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "50",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    const result = await registerTransfer(actor, {
      productId: tornillo,
      locationId: a,
      toLocationId: b,
      quantity: "2",
      presentationId: caja.presentationId,
    });
    expect(result).toMatchObject({
      ok: true,
      summary: expect.stringContaining("(2 cajas × 50 = 100 piezas)"),
    });
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "20",
      [b]: "180",
    });
  });

  it("keeps decimals exact", async () => {
    const cable = await product(actor, "Cable", "m");
    const a = await shelf(actor, `Rack ${++counter}`);
    const b = await shelf(actor, `Rack ${++counter}`);
    await registerEntry(actor, {
      productId: cable,
      locationId: a,
      quantity: "200",
    });
    await registerTransfer(actor, {
      productId: cable,
      locationId: a,
      toLocationId: b,
      quantity: "2.75",
    });
    expect(await getStockByLocation(actor, cable)).toEqual({
      [a]: "197.25",
      [b]: "2.75",
    });
    expect(await total(actor, cable)).toBe("200");
  });

  it("moving everything empties the origin", async () => {
    const { tornillo, a, b } = await scenario(actor);
    await registerTransfer(actor, {
      productId: tornillo,
      locationId: a,
      toLocationId: b,
      quantity: "120",
    });
    expect(await getStockByLocation(actor, tornillo)).toEqual({ [b]: "200" });
  });

  it("moves to a location that had none of the product, such as General", async () => {
    const { tornillo, a } = await scenario(actor);
    const general = (await getDefaultLocation(actor))?.id ?? "";
    await registerTransfer(actor, {
      productId: tornillo,
      locationId: a,
      toLocationId: general,
      quantity: "5",
    });
    expect((await getStockByLocation(actor, tornillo))[general]).toBe("5");
    expect(await total(actor, tornillo)).toBe("200");
  });
});

describe("what a relocation refuses", () => {
  it("more than the origin holds: nothing moves", async () => {
    const { tornillo, a, b } = await scenario(actor);
    expect(
      await registerTransfer(actor, {
        productId: tornillo,
        locationId: a,
        toLocationId: b,
        quantity: "121",
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: {
        quantity: expect.stringMatching(
          /^Solo hay 120 piezas en Estante A\d+: no se pueden mover 121 piezas\.$/,
        ),
      },
    });
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "120",
      [b]: "80",
    });
  });

  it("an origin without stock, the same location, or missing answers", async () => {
    const { tornillo, a, b } = await scenario(actor);
    const empty = await shelf(actor, `Vacío ${++counter}`);
    expect(
      await registerTransfer(actor, {
        productId: tornillo,
        locationId: empty,
        toLocationId: b,
        quantity: "1",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { quantity: expect.stringContaining("No hay existencias") },
    });
    expect(
      await registerTransfer(actor, {
        productId: tornillo,
        locationId: a,
        toLocationId: a,
        quantity: "1",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        toLocationId: "Elige una ubicación distinta a la de origen.",
      },
    });
    expect(
      await registerTransfer(actor, {
        productId: tornillo,
        locationId: "",
        toLocationId: "",
        quantity: "",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        locationId: "Elige de dónde sale.",
        toLocationId: "Elige a dónde va.",
        quantity: "Escribe la cantidad que se mueve.",
      },
    });
  });

  it("fractions of a piece, zero and text", async () => {
    const { tornillo, a, b } = await scenario(actor);
    for (const quantity of ["0.5", "0", "-3", "veinte"]) {
      expect(
        await registerTransfer(actor, {
          productId: tornillo,
          locationId: a,
          toLocationId: b,
          quantity,
        }),
        quantity,
      ).toMatchObject({
        ok: false,
        fieldErrors: { quantity: expect.any(String) },
      });
    }
    expect(await total(actor, tornillo)).toBe("200");
  });

  it("locations or products of another company", async () => {
    const theirs = await company();
    const foreign = await shelf(theirs, "Ajeno");
    const { tornillo, a, b } = await scenario(actor);
    expect(
      await registerTransfer(actor, {
        productId: tornillo,
        locationId: a,
        toLocationId: foreign,
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await registerTransfer(theirs, {
        productId: tornillo,
        locationId: a,
        toLocationId: b,
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "120",
      [b]: "80",
    });
  });

  it("an archived product", async () => {
    const tornillo = await product(actor);
    const a = await shelf(actor, `Estante ${++counter}`);
    const b = await shelf(actor, `Estante ${++counter}`);
    await archiveProduct(actor, tornillo);
    expect(
      await registerTransfer(actor, {
        productId: tornillo,
        locationId: a,
        toLocationId: b,
        quantity: "1",
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
  });

  it("people without the permission", async () => {
    const { tornillo, a, b } = await scenario(actor);
    for (const role of ["buyer", "viewer"] as const) {
      const other = await member(actor.organizationId, role);
      await expect(
        registerTransfer(other, {
          productId: tornillo,
          locationId: a,
          toLocationId: b,
          quantity: "1",
        }),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(
      await registerTransfer(warehouse, {
        productId: tornillo,
        locationId: a,
        toLocationId: b,
        quantity: "1",
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("relocations at the same time", () => {
  it("opposite relocations between two locations do not block each other and the total holds", async () => {
    const { tornillo, a, b } = await scenario(actor);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        registerTransfer(actor, {
          productId: tornillo,
          locationId: i % 2 === 0 ? a : b,
          toLocationId: i % 2 === 0 ? b : a,
          quantity: "10",
        }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "120",
      [b]: "80",
    });
    expect(await total(actor, tornillo)).toBe("200");
  });

  it("never moves more than the origin holds", async () => {
    const { tornillo, a, b } = await scenario(actor);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        registerTransfer(actor, {
          productId: tornillo,
          locationId: a,
          toLocationId: b,
          quantity: "50",
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "20",
      [b]: "180",
    });
  });

  it("a retried relocation with its key moves once", async () => {
    const { tornillo, a, b } = await scenario(actor);
    const request = {
      productId: tornillo,
      locationId: a,
      toLocationId: b,
      quantity: "20",
      idempotencyKey: newId(),
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => registerTransfer(actor, request)),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.repeated)).toHaveLength(1);
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "100",
      [b]: "100",
    });
    // The same key for the opposite direction is something else.
    expect(
      await registerTransfer(actor, {
        ...request,
        locationId: b,
        toLocationId: a,
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
  });
});

describe("after all of it", () => {
  it("balances still match the history", async () => {
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});
