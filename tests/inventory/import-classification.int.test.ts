import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  IMPORT_COLUMNS,
  classifyImport,
  registerEntry,
  saveImportMapping,
  startImport,
  type ImportColumnKey,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { archiveProduct, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-06: products of the file are new, updates or reactivations; the
// quota they need is shown. Nothing is written.

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
      email: `clasificar.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(productLimit = 10): Promise<InventoryActor> {
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
      reason: "Prueba de clasificación",
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
  input: {
    sku: string;
    name: string;
    unit?: string;
    barcode?: string;
    brand?: string;
  },
) {
  const result = await createProduct(owner, input);
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

/** An import of the given rows, with its columns set. */
async function imported(owner: InventoryActor, rows: Row[]) {
  const started = await startImport(owner, {
    name: "productos.csv",
    bytes: buildCsv(
      [HEADERS, ...rows.map((row) => KEYS.map((key) => row[key] ?? ""))],
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

async function classified(owner: InventoryActor, rows: Row[]) {
  const result = await classifyImport(owner, await imported(owner, rows));
  if (!result.ok) throw new Error(result.error);
  return result;
}

const row = (sku: string, extra: Row = {}): Row => ({
  sku,
  name: `Producto ${sku}`,
  unit: "pieza",
  ...extra,
});

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("classifyImport", () => {
  it("in an empty catalog everything is new and takes a place each", async () => {
    const actor = await company(10);
    const result = await classified(actor, [row("A"), row("B"), row("C")]);
    expect(result).toMatchObject({
      totalRows: 3,
      validRows: 3,
      invalidRows: 0,
      counts: { new: 3, update: 0, reactivate: 0 },
      quota: { limit: 10, used: 0, available: 10, required: 3, fits: true },
      conflicts: [],
      ready: true,
    });
    expect(result.products.map((p) => [p.row, p.sku, p.kind])).toEqual([
      [2, "A", "new"],
      [3, "B", "new"],
      [4, "C", "new"],
    ]);
  });

  it("an existing key is an update: it takes no place and shows what changes", async () => {
    const actor = await company(10);
    await product(actor, {
      sku: "TOR-1",
      name: "Tornillo",
      barcode: "750100",
      brand: "Fiero",
    });
    await product(actor, { sku: "CLA-2", name: "Clavo" });
    const result = await classified(actor, [
      // Same key in another case; new name and brand, barcode left empty.
      row("tor-1", { name: "Tornillo hexagonal", brand: "Truper" }),
      row("CLA-2", { name: "Clavo" }),
      row("NUE-3"),
    ]);
    expect(result).toMatchObject({
      counts: { new: 1, update: 2, reactivate: 0 },
      quota: { used: 2, available: 8, required: 1, fits: true },
      ready: true,
    });
    expect(result.products).toEqual([
      {
        row: 2,
        // The key keeps the form the catalog has.
        sku: "TOR-1",
        name: "Tornillo hexagonal",
        kind: "update",
        changes: [
          "Nombre: Tornillo → Tornillo hexagonal",
          "Marca: Fiero → Truper",
        ],
      },
      { row: 3, sku: "CLA-2", name: "Clavo", kind: "update", changes: [] },
      {
        row: 4,
        sku: "NUE-3",
        name: "Producto NUE-3",
        kind: "new",
        changes: [],
      },
    ]);
  });

  it("an archived product comes back and takes a place again", async () => {
    const actor = await company(10);
    const id = await product(actor, { sku: "VIE-1", name: "Descontinuado" });
    await archiveProduct(actor, id);
    const result = await classified(actor, [
      row("VIE-1", { name: "Descontinuado" }),
    ]);
    expect(result).toMatchObject({
      counts: { new: 0, update: 0, reactivate: 1 },
      quota: { used: 0, required: 1, fits: true },
    });
    expect(result.products[0]).toMatchObject({
      kind: "reactivate",
      changes: ["Está archivado: se reactiva"],
    });
  });

  it("a product in several rows counts once", async () => {
    const actor = await company(10);
    const shelf = await createLocation(actor, {
      kind: "SHELF",
      name: "Estante 1",
    });
    if (!shelf.ok) throw new Error("location setup failed");
    const result = await classified(actor, [
      row("TOR-1", { initialStock: "5" }),
      row("TOR-1", { initialStock: "7", location: "Estante 1" }),
      row("CLA-2"),
    ]);
    expect(result).toMatchObject({
      validRows: 3,
      counts: { new: 2 },
      quota: { required: 2 },
    });
    expect(result.products.map((p) => p.sku)).toEqual(["TOR-1", "CLA-2"]);
  });

  it("shows when the plan has no room, without cutting the file", async () => {
    const actor = await company(3);
    await product(actor, { sku: "YA-1", name: "Ya existe" });
    const result = await classified(actor, [
      row("YA-1", { name: "Ya existe" }),
      row("N-1"),
      row("N-2"),
      row("N-3"),
    ]);
    expect(result).toMatchObject({
      counts: { new: 3, update: 1 },
      quota: { limit: 3, used: 1, available: 2, required: 3, fits: false },
      conflicts: [],
      ready: false,
    });
    // Every product is still listed: nothing was dropped to make it fit.
    expect(result.products).toHaveLength(4);
    // With exactly the room it needs, it fits.
    const fitting = await classified(actor, [row("N-1"), row("N-2")]);
    expect(fitting).toMatchObject({
      quota: { required: 2, fits: true },
      ready: true,
    });
  });

  it("without a plan nothing fits", async () => {
    const owner = await newUser();
    const created = await createOrganization(owner, {
      name: "Sin plan",
      timeZone: "",
    });
    if (!created.ok) throw new Error("company setup failed");
    // The module with no product quota: nothing new can be added.
    await db.entitlement.create({
      data: {
        id: newId(),
        organizationId: created.organizationId,
        kind: "MODULE",
        key: "inventory",
        validFrom: new Date(Date.now() - 60_000),
      },
    });
    invalidateEntitlements();
    const actor = { organizationId: created.organizationId, userId: owner };
    const result = await classified(actor, [row("A")]);
    expect(result).toMatchObject({
      quota: { limit: null, available: 0, required: 1, fits: false },
      ready: false,
    });
  });

  it("reports what the catalog of today does not allow", async () => {
    const actor = await company(10);
    const moved = await product(actor, { sku: "MOV-1", name: "Con historia" });
    await registerEntry(actor, { productId: moved, quantity: "5" });
    await product(actor, { sku: "MET-2", name: "Cable", unit: "m" });
    await product(actor, { sku: "DUE-3", name: "Dueño", barcode: "750999" });
    const result = await classified(actor, [
      row("MOV-1", { name: "Con historia", initialStock: "9" }),
      row("MET-2", { name: "Cable", unit: "pieza" }),
      row("OTR-4", { barcode: "750999" }),
      row("DUE-3", { name: "Dueño", barcode: "750999" }),
      row("LIB-5", { initialStock: "3" }),
    ]);
    expect(result.ready).toBe(false);
    expect(result.conflictCount).toBe(3);
    expect(
      result.conflicts.map((c) => [c.row, c.column, c.header, c.value]),
    ).toEqual([
      [2, "initialStock", "Existencia inicial", "9"],
      [3, "unit", "Unidad", "piece"],
      [4, "barcode", "Código de barras", "750999"],
    ]);
    expect(result.conflicts[0]!.message).toContain("ya tiene movimientos");
    expect(result.conflicts[1]!.message).toContain("otra unidad");
    expect(result.conflicts[2]!.message).toContain("DUE-3");
  });

  it("rows with problems keep the import from being ready", async () => {
    const actor = await company(10);
    const result = await classified(actor, [
      row("A"),
      row("", { name: "Sin clave" }),
    ]);
    expect(result).toMatchObject({
      validRows: 1,
      invalidRows: 1,
      counts: { new: 1 },
      quota: { fits: true },
      ready: false,
    });
  });

  it("writes nothing and takes no place", async () => {
    const actor = await company(5);
    await product(actor, { sku: "YA-1", name: "Ya existe" });
    const importId = await imported(actor, [
      row("YA-1", { name: "Otro nombre" }),
      row("N-1", { initialStock: "4", minimum: "2" }),
    ]);
    const snapshot = async () => ({
      products: await db.product.findMany({
        where: { organizationId: actor.organizationId },
        orderBy: { sku: "asc" },
        select: { sku: true, name: true, status: true },
      }),
      quota: await db.quotaUsage.findMany({
        where: { organizationId: actor.organizationId },
        select: { key: true, taken: true, reserved: true },
      }),
      movements: await db.stockMovement.count({
        where: { organizationId: actor.organizationId },
      }),
      minimums: await db.stockMinimum.count({
        where: { organizationId: actor.organizationId },
      }),
    });
    const before = await snapshot();
    const first = await classifyImport(actor, importId);
    const second = await classifyImport(actor, importId);
    expect(second).toEqual(first);
    expect(await snapshot()).toEqual(before);
  });

  it("looks only at its own company's catalog", async () => {
    const theirs = await company(10);
    await product(theirs, {
      sku: "TOR-1",
      name: "De ellos",
      barcode: "750111",
    });
    const actor = await company(10);
    const importId = await imported(actor, [
      row("TOR-1", { barcode: "750111" }),
    ]);
    const result = await classifyImport(actor, importId);
    // Their product with the same key and barcode is not ours.
    expect(result).toMatchObject({
      ok: true,
      counts: { new: 1, update: 0 },
      conflicts: [],
      ready: true,
    });
    expect(await classifyImport(theirs, importId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    await expect(
      classifyImport(await member(actor.organizationId, "viewer"), importId),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
});
