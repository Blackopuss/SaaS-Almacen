import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  MOVEMENT_PAGE_SIZE,
  listMovementAuthors,
  listMovements,
  registerAdjustment,
  registerEntry,
  registerExit,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-27: history of movements with filters by date, product, person and
// kind.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser(name = "Persona") {
  const user = await db.user.create({
    data: {
      id: newId(),
      name,
      email: `historial.${++counter}.${stamp}@example.test`,
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
      productLimit: 60,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba del historial",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function member(organizationId: string, role: Role, name: string) {
  const userId = await newUser(name);
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  await db.membershipRole.create({
    data: { id: newId(), organizationId, membershipId: membership.id, role },
  });
  return { organizationId, userId };
}

async function product(owner: InventoryActor, name: string) {
  const result = await createProduct(owner, { sku: `H-${++counter}`, name });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

/** A movement confirmed at a past moment (the fixture writes the date). */
async function movementAt(owner: InventoryActor, createdAt: string) {
  const id = newId();
  await db.stockMovement.create({
    data: {
      id,
      organizationId: owner.organizationId,
      type: "ENTRY",
      createdByUserId: owner.userId,
      createdAt: new Date(createdAt),
    },
  });
  return id;
}

let actor: InventoryActor;
let lupita: InventoryActor;
let tornillo = "";
let clavo = "";

beforeAll(async () => {
  actor = await company();
  lupita = await member(actor.organizationId, "warehouse", "Lupita Ramos");
  tornillo = await product(actor, "Tornillo");
  clavo = await product(actor, "Clavo");

  await registerEntry(actor, { productId: tornillo, quantity: "100" });
  await registerEntry(lupita, { productId: clavo, quantity: "50" });
  await registerExit(lupita, { productId: tornillo, quantity: "10" });
  await registerAdjustment(actor, {
    productId: clavo,
    quantity: "48",
    reason: "Dos piezas dañadas",
  });
}, 60_000);

afterEach(() => invalidateEntitlements());

afterAll(() => db.$disconnect());

const types = async (filters: Parameters<typeof listMovements>[1]) =>
  (await listMovements(actor, filters)).items.map((m) => m.type);

describe("listMovements", () => {
  it("without filters lists everything, newest first", async () => {
    const page = await listMovements(actor);
    expect(page).toMatchObject({ total: 4, page: 1, pageCount: 1 });
    expect(page.items.map((m) => m.type)).toEqual([
      "ADJUSTMENT",
      "EXIT",
      "ENTRY",
      "ENTRY",
    ]);
    expect(page.applied).toEqual({
      from: null,
      to: null,
      productId: null,
      productSearch: null,
      userId: null,
      type: null,
    });
  });

  it("filters by kind", async () => {
    expect(await types({ type: "ENTRY" })).toEqual(["ENTRY", "ENTRY"]);
    expect(await types({ type: "ADJUSTMENT" })).toEqual(["ADJUSTMENT"]);
    expect(await types({ type: "TRANSFER" })).toEqual([]);
  });

  it("filters by product", async () => {
    expect(await types({ productId: tornillo })).toEqual(["EXIT", "ENTRY"]);
    expect(await types({ productId: clavo })).toEqual(["ADJUSTMENT", "ENTRY"]);
    expect(await types({ productId: newId() })).toEqual([]);
  });

  it("filters by part of the name or the SKU of a product", async () => {
    expect(await types({ productSearch: "torni" })).toEqual(["EXIT", "ENTRY"]);
    expect(await types({ productSearch: "  CLAVO " })).toEqual([
      "ADJUSTMENT",
      "ENTRY",
    ]);
    expect(await types({ productSearch: "H-" })).toHaveLength(4);
    expect(await types({ productSearch: "martillo" })).toEqual([]);
    // A wildcard is text, not a pattern.
    expect(await types({ productSearch: "%" })).toEqual([]);
  });

  it("filters by the person who confirmed", async () => {
    expect(await types({ userId: lupita.userId })).toEqual(["EXIT", "ENTRY"]);
    expect(await types({ userId: actor.userId })).toEqual([
      "ADJUSTMENT",
      "ENTRY",
    ]);
    const [first] = (await listMovements(actor, { userId: lupita.userId }))
      .items;
    expect(first?.authorName).toBe("Lupita Ramos");
  });

  it("filters by days of the company's calendar, both included", async () => {
    const owner = await company();
    // 23:30 of September 30 in central Mexico is already October 1 in UTC.
    const lastNightOfSeptember = await movementAt(
      owner,
      "2026-10-01T05:30:00.000Z",
    );
    const firstMinutesOfOctober = await movementAt(
      owner,
      "2026-10-01T06:30:00.000Z",
    );
    const ids = async (filters: Parameters<typeof listMovements>[1]) =>
      (await listMovements(owner, filters)).items.map((m) => m.id);

    expect(await ids({ from: "2026-09-30", to: "2026-09-30" })).toEqual([
      lastNightOfSeptember,
    ]);
    expect(await ids({ from: "2026-10-01", to: "2026-10-01" })).toEqual([
      firstMinutesOfOctober,
    ]);
    expect(await ids({ to: "2026-10-01" })).toEqual([
      firstMinutesOfOctober,
      lastNightOfSeptember,
    ]);
    expect(await ids({ from: "2026-10-01" })).toEqual([firstMinutesOfOctober]);
    expect(await ids({ from: "2026-10-02" })).toEqual([]);
    expect(await ids({ to: "2026-09-29" })).toEqual([]);
    const page = await listMovements(owner, {
      from: "2026-09-30",
      to: "2026-10-01",
    });
    expect(page.total).toBe(2);
    expect(page.applied).toMatchObject({
      from: "2026-09-30",
      to: "2026-10-01",
    });
  });

  it("combines filters", async () => {
    expect(await types({ productId: tornillo, userId: lupita.userId })).toEqual(
      ["EXIT"],
    );
    expect(
      await types({ type: "ENTRY", userId: lupita.userId, productId: clavo }),
    ).toEqual(["ENTRY"]);
    expect(
      await types({ type: "ENTRY", productId: tornillo, to: "2026-01-01" }),
    ).toEqual([]);
  });

  it("ignores filters it cannot read instead of failing", async () => {
    const page = await listMovements(actor, {
      from: "ayer",
      to: "2026-13-45",
      type: "ROBO",
      page: -3,
    });
    expect(page.total).toBe(4);
    expect(page.page).toBe(1);
    expect(page.applied).toMatchObject({ from: null, to: null, type: null });
  });

  it("only people who may read movements; never another company's", async () => {
    const theirs = await company();
    expect((await listMovements(theirs)).total).toBe(0);
    expect((await listMovements(theirs, { productId: tornillo })).total).toBe(
      0,
    );
    expect((await listMovements(theirs, { userId: lupita.userId })).total).toBe(
      0,
    );
    await expect(
      listMovements({
        organizationId: actor.organizationId,
        userId: theirs.userId,
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const viewer = await member(actor.organizationId, "viewer", "Consulta");
    expect((await listMovements(viewer)).total).toBe(4);
  });
});

describe("pages", () => {
  it("shows one page at a time and keeps the filters across pages", async () => {
    const owner = await company();
    const bolt = await product(owner, "Perno");
    await registerEntry(owner, { productId: bolt, quantity: "1000" });
    for (let i = 0; i < MOVEMENT_PAGE_SIZE + 4; i++) {
      await registerExit(owner, { productId: bolt, quantity: "1" });
    }
    const first = await listMovements(owner, { type: "EXIT" });
    expect(first).toMatchObject({
      total: MOVEMENT_PAGE_SIZE + 4,
      page: 1,
      pageCount: 2,
    });
    expect(first.items).toHaveLength(MOVEMENT_PAGE_SIZE);
    const second = await listMovements(owner, { type: "EXIT", page: 2 });
    expect(second.items).toHaveLength(4);
    const seen = new Set([...first.items, ...second.items].map((m) => m.id));
    expect(seen.size).toBe(MOVEMENT_PAGE_SIZE + 4);
    // A page beyond the last one shows the last one.
    expect((await listMovements(owner, { type: "EXIT", page: 99 })).page).toBe(
      2,
    );
  }, 120_000);
});

describe("listMovementAuthors", () => {
  it("lists who has confirmed movements in the company, by name", async () => {
    expect(await listMovementAuthors(actor)).toEqual([
      { userId: actor.userId, name: "Doña Esperanza" },
      { userId: lupita.userId, name: "Lupita Ramos" },
    ]);
    const theirs = await company();
    expect(await listMovementAuthors(theirs)).toEqual([]);
  });
});
