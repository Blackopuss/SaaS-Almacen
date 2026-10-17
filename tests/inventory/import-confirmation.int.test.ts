import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  IMPORT_COLUMNS,
  confirmImport,
  getImport,
  saveImportMapping,
  startImport,
  type ImportColumnKey,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { archiveProduct, createProduct } from "@/platform/catalog";
import { getQuotaUsage, invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-07: atomic reservation of quota. An import and a manual product
// created at the same time never exceed the plan.

const KEYS = IMPORT_COLUMNS.map((column) => column.key);
const HEADERS = IMPORT_COLUMNS.map((column) => column.header);
const MAPPING = Object.fromEntries(KEYS.map((key, index) => [key, index]));
type Row = Partial<Record<ImportColumnKey, string>>;

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `confirmar.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(productLimit: number): Promise<InventoryActor> {
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
      productLimit,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de confirmación",
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

const row = (sku: string, extra: Row = {}): Row => ({
  sku,
  name: `Producto ${sku}`,
  unit: "pieza",
  ...extra,
});

/** `count` new products: N-1 … N-count. */
const fresh = (count: number, prefix = "N") =>
  Array.from({ length: count }, (_, i) => row(`${prefix}-${i + 1}`));

/** An import of the given rows, with its columns set. */
async function imported(owner: InventoryActor, rows: Row[]) {
  const started = await startImport(owner, {
    name: "productos.csv",
    bytes: buildCsv(
      [HEADERS, ...rows.map((line) => KEYS.map((key) => line[key] ?? ""))],
      { neutralize: false },
    ),
  });
  if (!started.ok) throw new Error(started.error);
  const saved = await saveImportMapping(owner, {
    importId: started.importId,
    mapping: MAPPING,
    decimalSeparator: ".",
  });
  if (!saved.ok) throw new Error("mapping not saved");
  return started.importId;
}

const usage = (owner: InventoryActor) =>
  getQuotaUsage(owner.organizationId, "active_products");

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("confirmImport", () => {
  it("holds the places its new products need and closes the import", async () => {
    const actor = await company(10);
    const existing = await createProduct(actor, {
      sku: "YA-1",
      name: "Ya existe",
    });
    if (!existing.ok) throw new Error("product setup failed");
    const importId = await imported(actor, [
      row("YA-1", { name: "Con otro nombre" }),
      ...fresh(3),
    ]);
    expect(await confirmImport(actor, importId)).toEqual({
      ok: true,
      reserved: 3,
    });
    // Held, not used yet: no product was created.
    expect(await usage(actor)).toEqual({
      limit: 10,
      used: 1,
      reserved: 3,
      available: 6,
    });
    expect(
      await db.product.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(1);
    const stored = await db.productImport.findUniqueOrThrow({
      where: { id: importId },
    });
    expect(stored).toMatchObject({
      status: "CONFIRMED",
      reservedPlaces: 3,
      confirmedByUserId: actor.userId,
    });
    expect(stored.confirmedAt).toBeInstanceOf(Date);
    const audit = await db.auditEvent.findFirst({
      where: {
        organizationId: actor.organizationId,
        action: "inventory.import_confirmed",
        targetId: importId,
      },
    });
    expect(audit).toMatchObject({ actorUserId: actor.userId });
  });

  it("confirming twice holds once", async () => {
    const actor = await company(10);
    const importId = await imported(actor, fresh(4));
    const first = await confirmImport(actor, importId);
    const again = await confirmImport(actor, importId);
    expect(first).toEqual({ ok: true, reserved: 4 });
    expect(again).toEqual({ ok: true, reserved: 4, repeated: true });
    expect(await usage(actor)).toMatchObject({ reserved: 4, available: 6 });
  });

  it("two confirmations at once hold once", async () => {
    const actor = await company(10);
    const importId = await imported(actor, fresh(4));
    const results = await Promise.all([
      confirmImport(actor, importId),
      confirmImport(actor, importId),
      confirmImport(actor, importId),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      results.filter((result) => result.ok && !result.repeated),
    ).toHaveLength(1);
    expect(await usage(actor)).toMatchObject({ reserved: 4, available: 6 });
  }, 60_000);

  it("all the places or none: an import that does not fit holds nothing", async () => {
    const actor = await company(3);
    const importId = await imported(actor, fresh(4));
    const result = await confirmImport(actor, importId);
    expect(result).toMatchObject({ ok: false, reason: "no_room" });
    if (result.ok) return;
    expect(result.error).toContain("necesita 4 lugares");
    expect(result.error).toContain("quedan 3");
    expect(await usage(actor)).toMatchObject({
      used: 0,
      reserved: 0,
      available: 3,
    });
    expect((await getImport(actor, importId))!.status).toBe("READY");
  });

  it("an import and manual products at once never exceed the plan", async () => {
    // Room for 6; the import wants 4 and five people add one each.
    const actor = await company(6);
    const importId = await imported(actor, fresh(4));
    const [confirmation, ...manual] = await Promise.all([
      confirmImport(actor, importId),
      ...Array.from({ length: 5 }, (_, i) =>
        createProduct(actor, { sku: `MAN-${i}`, name: `Manual ${i}` }),
      ),
    ]);
    const created = manual.filter((result) => result.ok).length;
    const state = await usage(actor);
    // Whoever arrived first, the counter never passes the limit.
    expect(state.used + state.reserved).toBeLessThanOrEqual(6);
    expect(state.used).toBe(created);
    if (confirmation.ok) {
      expect(state.reserved).toBe(4);
      expect(created).toBe(2);
    } else {
      // The manual ones took the room first: the import held nothing.
      expect(confirmation.reason).toBe("no_room");
      expect(state.reserved).toBe(0);
      expect(created).toBeGreaterThanOrEqual(3);
    }
    for (const refused of manual.filter((result) => !result.ok)) {
      expect(refused).toMatchObject({ reason: "limit_reached" });
    }
  }, 60_000);

  it("the very first products of a company, all at once, never collide", async () => {
    // Nothing has ever counted against these plans: the import and the
    // manual products arrive together at a counter nobody has used yet.
    for (let round = 0; round < 6; round++) {
      const actor = await company(5);
      const importId = await imported(actor, fresh(2));
      const results = await Promise.allSettled([
        confirmImport(actor, importId),
        ...Array.from({ length: 9 }, (_, i) =>
          createProduct(actor, { sku: `PRI-${i}`, name: `Primero ${i}` }),
        ),
      ]);
      // Every one got an answer: none failed on a lock.
      expect(
        results.filter((result) => result.status === "rejected"),
        `round ${round}`,
      ).toEqual([]);
      const state = await usage(actor);
      expect(state.used + state.reserved).toBe(5);
    }
  }, 120_000);

  it("held places count against manual products afterwards", async () => {
    const actor = await company(5);
    const importId = await imported(actor, fresh(4));
    expect((await confirmImport(actor, importId)).ok).toBe(true);
    expect(
      (await createProduct(actor, { sku: "UNO", name: "Cabe uno" })).ok,
    ).toBe(true);
    const full = await createProduct(actor, { sku: "DOS", name: "Ya no cabe" });
    expect(full).toMatchObject({ ok: false, reason: "limit_reached" });
    expect(await usage(actor)).toEqual({
      limit: 5,
      used: 1,
      reserved: 4,
      available: 0,
    });
  });

  it("reactivated products need a place; updates do not", async () => {
    const actor = await company(3);
    const active = await createProduct(actor, { sku: "ACT", name: "Activo" });
    const archived = await createProduct(actor, {
      sku: "ARC",
      name: "Archivado",
    });
    if (!active.ok || !archived.ok) throw new Error("product setup failed");
    await archiveProduct(actor, archived.productId);
    const onlyUpdates = await imported(actor, [row("ACT", { name: "Activo" })]);
    expect(await confirmImport(actor, onlyUpdates)).toEqual({
      ok: true,
      reserved: 0,
    });
    expect(await usage(actor)).toMatchObject({ used: 1, reserved: 0 });
    const withReturn = await imported(actor, [
      row("ARC", { name: "Archivado" }),
      row("NUEVO"),
    ]);
    expect(await confirmImport(actor, withReturn)).toEqual({
      ok: true,
      reserved: 2,
    });
    expect(await usage(actor)).toMatchObject({
      used: 1,
      reserved: 2,
      available: 0,
    });
  });

  it("refuses imports that are not ready", async () => {
    const actor = await company(10);
    const withErrors = await imported(actor, [
      row("A"),
      row("", { name: "Sin clave" }),
    ]);
    expect(await confirmImport(actor, withErrors)).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    const blocker = await createProduct(actor, {
      sku: "MET",
      name: "Cable",
      unit: "m",
    });
    if (!blocker.ok) throw new Error("product setup failed");
    const withConflict = await imported(actor, [row("MET", { name: "Cable" })]);
    expect(await confirmImport(actor, withConflict)).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    const unmapped = await startImport(actor, {
      name: "sin-mapa.csv",
      bytes: buildCsv([HEADERS, KEYS.map((key) => row("B")[key] ?? "")]),
    });
    if (!unmapped.ok) throw new Error(unmapped.error);
    expect(await confirmImport(actor, unmapped.importId)).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    expect(await confirmImport(actor, newId())).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await usage(actor)).toMatchObject({ used: 1, reserved: 0 });
  });

  it("a confirmed import no longer changes its columns", async () => {
    const actor = await company(10);
    const importId = await imported(actor, fresh(2));
    await confirmImport(actor, importId);
    const result = await saveImportMapping(actor, {
      importId,
      mapping: MAPPING,
      decimalSeparator: ",",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.formError).toContain("ya se confirmó");
    expect(await getImport(actor, importId)).toMatchObject({
      status: "CONFIRMED",
      decimalSeparator: ".",
    });
  });

  it("only who may confirm imports, and only their company's", async () => {
    const actor = await company(10);
    const importId = await imported(actor, fresh(2));
    const denied = { code: "permission_denied" };
    for (const role of ["viewer", "buyer"] as const) {
      await expect(
        confirmImport(await member(actor.organizationId, role), importId),
      ).rejects.toMatchObject(denied);
    }
    const theirs = await company(10);
    expect(await confirmImport(theirs, importId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await usage(theirs)).toMatchObject({ reserved: 0 });
    expect(await usage(actor)).toMatchObject({ reserved: 0 });
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(await confirmImport(warehouse, importId)).toEqual({
      ok: true,
      reserved: 2,
    });
  });
});
