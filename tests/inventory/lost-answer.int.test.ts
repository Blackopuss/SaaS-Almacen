import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  findConfirmation,
  getStockTotals,
  registerEntry,
  registerExit,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { createProduct } from "@/platform/catalog";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-22: when the answer of a confirmation is lost, the screen asks
// whether it was registered and resolves without duplicating (NET-01).

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `red.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de conexión perdida",
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

let actor: InventoryActor;
let tornillo = "";

beforeAll(async () => {
  actor = await company();
  const product = await createProduct(actor, { sku: "T-1", name: "Tornillo" });
  if (!product.ok) throw new Error("product setup failed");
  tornillo = product.productId;
});

afterAll(async () => {
  await db.$disconnect();
});

const stock = async () =>
  (await getStockTotals(actor, [tornillo]))[tornillo] ?? "0";

describe("findConfirmation", () => {
  it("answers «not registered» when the request never arrived, and the retry registers it once", async () => {
    const idempotencyKey = newId();
    // The connection dropped before the server saw anything.
    expect(await findConfirmation(actor, idempotencyKey)).toBeNull();
    const before = await stock();
    const retry = await registerEntry(actor, {
      productId: tornillo,
      quantity: "40",
      idempotencyKey,
    });
    expect(retry).toMatchObject({ ok: true });
    expect(Number(await stock())).toBe(Number(before) + 40);
  });

  it("answers «registered» when only the answer was lost, so nothing is sent again", async () => {
    const idempotencyKey = newId();
    const before = Number(await stock());
    // The server registered it; the browser never got the answer.
    const lost = await registerExit(actor, {
      productId: tornillo,
      quantity: "15",
      idempotencyKey,
    });
    if (!lost.ok) throw new Error("expected ok");

    expect(await findConfirmation(actor, idempotencyKey)).toEqual({
      movementId: lost.movementId,
    });
    // And if the person sends it again anyway, it is still one movement.
    expect(
      await registerExit(actor, {
        productId: tornillo,
        quantity: "15",
        idempotencyKey,
      }),
    ).toMatchObject({ ok: true, repeated: true, movementId: lost.movementId });
    expect(Number(await stock())).toBe(before - 15);
    expect(
      await db.stockMovement.count({
        where: { organizationId: actor.organizationId, idempotencyKey },
      }),
    ).toBe(1);
  });

  it("only answers to the person who confirmed", async () => {
    const idempotencyKey = newId();
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "1",
      idempotencyKey,
    });
    const colleague = await member(actor.organizationId, "warehouse");
    expect(await findConfirmation(colleague, idempotencyKey)).toBeNull();
    expect(await findConfirmation(actor, idempotencyKey)).not.toBeNull();
  });

  it("another company learns nothing from a key", async () => {
    const idempotencyKey = newId();
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "1",
      idempotencyKey,
    });
    const theirs = await company();
    expect(await findConfirmation(theirs, idempotencyKey)).toBeNull();
    await expect(
      findConfirmation(
        { organizationId: actor.organizationId, userId: theirs.userId },
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it.each(["", "corta", "x".repeat(65), "con espacios"])(
    "a malformed key %j matches nothing",
    async (idempotencyKey) => {
      expect(await findConfirmation(actor, idempotencyKey)).toBeNull();
    },
  );

  it("writes nothing", async () => {
    const before = await db.stockMovement.count({
      where: { organizationId: actor.organizationId },
    });
    await findConfirmation(actor, newId());
    expect(
      await db.stockMovement.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(before);
  });
});
