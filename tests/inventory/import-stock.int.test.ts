import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  IMPORT_COLUMNS,
  applyImport,
  confirmImport,
  getImport,
  importPermissions,
  listImportFailures,
  reconcileStock,
  registerEntry,
  registerInitialBalance,
  saveImportMapping,
  startImport,
  type ImportColumnKey,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  changePresentationFactor,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { getQuotaUsage, invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import { archiveLocation, createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-09: the stock of the file enters as initial-balance movements, by
// location. Balances equal the file; retrying duplicates no movement even
// if a factor changes while the import runs.

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
      email: `saldosimp.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(productLimit = 50): Promise<InventoryActor> {
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
      reason: "Prueba de saldos importados",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

/** «Zona A» with «Estante 3» inside; returns the id of the shelf. */
async function shelf(actor: InventoryActor) {
  const zone = await createLocation(actor, { name: "Zona A", kind: "ZONE" });
  if (!zone.ok) throw new Error("zone setup failed");
  const made = await createLocation(actor, {
    name: "Estante 3",
    kind: "SHELF",
    parentId: zone.locationId,
  });
  if (!made.ok) throw new Error("shelf setup failed");
  return made.locationId;
}

const row = (sku: string, extra: Row = {}): Row => ({
  sku,
  name: `Producto ${sku}`,
  unit: "pieza",
  ...extra,
});

async function confirmed(owner: InventoryActor, rows: Row[]) {
  const started = await startImport(owner, {
    name: "inventario.csv",
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
  const result = await confirmImport(owner, started.importId);
  if (!result.ok) throw new Error(result.error);
  return started.importId;
}

/** Balances of the company: «SKU @ location = quantity». */
async function balances(owner: InventoryActor) {
  const rows = await db.stockBalance.findMany({
    where: { organizationId: owner.organizationId },
    select: {
      quantity: true,
      product: { select: { sku: true } },
      location: { select: { name: true } },
    },
  });
  return rows
    .map(
      (balance) =>
        `${balance.product.sku} @ ${balance.location.name} = ${balance.quantity.toString()}`,
    )
    .sort();
}

/** Lines of the movements of the company, as they were written. */
async function lines(owner: InventoryActor) {
  const rows = await db.stockMovementLine.findMany({
    where: { organizationId: owner.organizationId },
    orderBy: [{ product: { sku: "asc" } }, { location: { name: "asc" } }],
    select: {
      capturedQuantity: true,
      factor: true,
      baseQuantity: true,
      direction: true,
      presentationId: true,
      presentationVersion: { select: { factor: true } },
      product: { select: { sku: true } },
      location: { select: { name: true } },
      movement: {
        select: {
          type: true,
          reference: true,
          idempotencyKey: true,
          createdByUserId: true,
        },
      },
    },
  });
  return rows;
}

const shape = (line: Awaited<ReturnType<typeof lines>>[number]) =>
  `${line.product.sku} @ ${line.location.name}: ${line.capturedQuantity} × ${line.factor} = ${line.baseQuantity}`;

beforeEach(async () => {
  await db.job.deleteMany({});
});
afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("initial stock from the file", () => {
  it("balances equal the file, by location, written as movements", async () => {
    const actor = await company(10);
    await shelf(actor);
    const importId = await confirmed(actor, [
      // In the unit, in General.
      row("TOR-1", { initialStock: "250" }),
      // In its presentation: 3 boxes of 100.
      row("CLA-2", {
        presentation: "Caja",
        presentationContent: "100",
        initialStock: "3",
        initialStockIn: "Caja",
        location: "Zona A › Estante 3",
      }),
      // The same product in two places, one of them loose pieces.
      row("CLA-2", { initialStock: "40" }),
      // Fractions, by the meter.
      row("CAB-3", {
        unit: "metro",
        initialStock: "12.5",
        location: "General",
      }),
      // Without stock: only the product.
      row("SIN-4"),
    ]);
    expect(await balances(actor)).toEqual([]);

    expect(await applyImport(actor.organizationId, importId)).toEqual({
      ok: true,
      status: "DONE",
      processed: 4,
      failed: 0,
    });
    expect(await balances(actor)).toEqual([
      "CAB-3 @ General = 12.5",
      "CLA-2 @ Estante 3 = 300",
      "CLA-2 @ General = 40",
      "TOR-1 @ General = 250",
    ]);
    const written = await lines(actor);
    expect(written.map(shape)).toEqual([
      "CAB-3 @ General: 12.5 × 1 = 12.5",
      "CLA-2 @ Estante 3: 3 × 100 = 300",
      "CLA-2 @ General: 40 × 1 = 40",
      "TOR-1 @ General: 250 × 1 = 250",
    ]);
    for (const line of written) {
      expect(line.direction).toBe("IN");
      expect(line.movement.type).toBe("INITIAL");
      expect(line.movement.createdByUserId).toBe(actor.userId);
      expect(line.movement.reference).toMatch(/^Importación, fila \d+$/);
      expect(line.movement.idempotencyKey).toMatch(
        /^import:[0-9a-f-]{36}:\d+$/,
      );
    }
    // The boxes keep the presentation and the version they were counted with.
    expect(written[1]!.presentationId).not.toBeNull();
    expect(written[1]!.presentationVersion!.factor.toString()).toBe("100");
    expect(written[2]!.presentationId).toBeNull();
    expect(await reconcileStock(actor.organizationId)).toEqual([]);

    // The rules of an initial balance still hold afterwards.
    const tornillo = await db.product.findFirstOrThrow({
      where: { organizationId: actor.organizationId, sku: "TOR-1" },
    });
    expect(
      await registerInitialBalance(actor, {
        productId: tornillo.id,
        quantity: "5",
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
  });

  it("retrying, or two workers at once, never writes a movement twice", async () => {
    const actor = await company(40);
    const importId = await confirmed(
      actor,
      Array.from({ length: 14 }, (_, i) =>
        row(`R-${String(i).padStart(2, "0")}`, { initialStock: String(i + 1) }),
      ),
    );
    let batches = 0;
    await expect(
      applyImport(actor.organizationId, importId, {
        batchSize: 4,
        onBatch: () => {
          if (++batches === 2) throw new Error("the worker died");
        },
      }),
    ).rejects.toThrow("the worker died");
    expect(await balances(actor)).toHaveLength(8);

    const results = await Promise.all([
      applyImport(actor.organizationId, importId, { batchSize: 3 }),
      applyImport(actor.organizationId, importId, { batchSize: 3 }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    await applyImport(actor.organizationId, importId);

    const written = await lines(actor);
    expect(written).toHaveLength(14);
    expect(written.map((line) => line.baseQuantity.toString())).toEqual(
      Array.from({ length: 14 }, (_, i) => String(i + 1)),
    );
    expect(
      new Set(written.map((line) => line.movement.idempotencyKey)).size,
    ).toBe(14);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("a factor changed while the import runs does not change what enters", async () => {
    const actor = await company(20);
    const first = await createProduct(actor, { sku: "A-1", name: "Primero" });
    const second = await createProduct(actor, { sku: "B-2", name: "Segundo" });
    if (!first.ok || !second.ok) throw new Error("product setup failed");
    const boxes = [];
    for (const product of [first, second]) {
      const caja = await createPresentation(actor, product.productId, {
        name: "Caja",
        factor: "100",
      });
      if (!caja.ok) throw new Error("presentation setup failed");
      boxes.push(caja.presentationId);
    }
    const stocked = (sku: string): Row =>
      row(sku, {
        presentation: "Caja",
        presentationContent: "100",
        initialStock: "2",
        initialStockIn: "Caja",
      });
    const importId = await confirmed(actor, [stocked("A-1"), stocked("B-2")]);

    // The first product enters; the worker dies before the second.
    await expect(
      applyImport(actor.organizationId, importId, {
        batchSize: 1,
        onBatch: () => {
          throw new Error("the worker died");
        },
      }),
    ).rejects.toThrow("the worker died");
    expect(await balances(actor)).toEqual(["A-1 @ General = 200"]);

    // Meanwhile someone changes both boxes by hand.
    for (const presentationId of boxes) {
      const changed = await changePresentationFactor(actor, presentationId, {
        factor: "144",
        reason: "Cambio manual durante la importación",
      });
      expect(changed.ok).toBe(true);
    }
    expect(await applyImport(actor.organizationId, importId)).toMatchObject({
      ok: true,
      processed: 2,
      failed: 0,
    });

    // Both entered with what was confirmed: 2 × 100, once each.
    expect(await balances(actor)).toEqual([
      "A-1 @ General = 200",
      "B-2 @ General = 200",
    ]);
    const written = await lines(actor);
    expect(written.map(shape)).toEqual([
      "A-1 @ General: 2 × 100 = 200",
      "B-2 @ General: 2 × 100 = 200",
    ]);
    for (const line of written) {
      expect(line.presentationVersion!.factor.toString()).toBe("100");
    }
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("a product that started moving after confirming is left whole, as it was", async () => {
    const actor = await company(10);
    const moved = await createProduct(actor, {
      sku: "MOV-1",
      name: "Original",
    });
    const counted = await createProduct(actor, {
      sku: "INI-2",
      name: "Contado",
    });
    if (!moved.ok || !counted.ok) throw new Error("product setup failed");
    const importId = await confirmed(actor, [
      row("MOV-1", { name: "Nombre del archivo", initialStock: "10" }),
      row("INI-2", { name: "Otro nombre", initialStock: "7" }),
      row("NUE-3", { initialStock: "4" }),
    ]);
    expect(
      await getQuotaUsage(actor.organizationId, "active_products"),
    ).toMatchObject({ used: 2, reserved: 1 });
    // After confirming: an entry on one, its initial balance on the other.
    expect(
      (
        await registerEntry(actor, {
          productId: moved.productId,
          quantity: "3",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await registerInitialBalance(actor, {
          productId: counted.productId,
          quantity: "9",
        })
      ).ok,
    ).toBe(true);

    expect(await applyImport(actor.organizationId, importId)).toEqual({
      ok: true,
      status: "DONE",
      processed: 3,
      failed: 2,
    });
    const failures = await listImportFailures(actor, importId);
    expect(failures.map((failure) => failure.sku)).toEqual(["MOV-1", "INI-2"]);
    expect(failures[0]!.error).toContain("ya tiene movimientos");
    expect(failures[1]!.error).toContain("ya tiene saldo inicial en «General»");
    // Nothing of those products changed, not even the name.
    const catalog = await db.product.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { sku: "asc" },
      select: { sku: true, name: true },
    });
    expect(catalog).toEqual([
      { sku: "INI-2", name: "Contado" },
      { sku: "MOV-1", name: "Original" },
      { sku: "NUE-3", name: "Producto NUE-3" },
    ]);
    expect(await balances(actor)).toEqual([
      "INI-2 @ General = 9",
      "MOV-1 @ General = 3",
      "NUE-3 @ General = 4",
    ]);
    expect(
      await getQuotaUsage(actor.organizationId, "active_products"),
    ).toMatchObject({ used: 3, reserved: 0 });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("a location archived after confirming: the product is not created and its place goes back", async () => {
    const actor = await company(10);
    const shelfId = await shelf(actor);
    const importId = await confirmed(actor, [
      row("EST-1", { initialStock: "6", location: "Zona A › Estante 3" }),
      row("GEN-2", { initialStock: "2" }),
    ]);
    expect((await archiveLocation(actor, shelfId)).ok).toBe(true);

    expect(await applyImport(actor.organizationId, importId)).toMatchObject({
      ok: true,
      processed: 2,
      failed: 1,
    });
    const [failure] = await listImportFailures(actor, importId);
    expect(failure).toMatchObject({ sku: "EST-1" });
    expect(failure!.error).toContain("«Estante 3» se archivó");
    expect(
      await db.product.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(1);
    expect(await balances(actor)).toEqual(["GEN-2 @ General = 2"]);
    expect(
      await getQuotaUsage(actor.organizationId, "active_products"),
    ).toMatchObject({ used: 1, reserved: 0 });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("an existing product without movements, and one that comes back, get their stock", async () => {
    const actor = await company(10);
    const existing = await createProduct(actor, {
      sku: "EXI-1",
      name: "Existe",
    });
    if (!existing.ok) throw new Error("product setup failed");
    const importId = await confirmed(actor, [
      row("EXI-1", { name: "Existe", initialStock: "15" }),
    ]);
    await applyImport(actor.organizationId, importId);
    expect(await balances(actor)).toEqual(["EXI-1 @ General = 15"]);
    expect(await getImport(actor, importId)).toMatchObject({
      status: "DONE",
      failedItems: 0,
    });
    // A second file cannot give it initial stock again: it is refused
    // before confirming, as a clash with the catalog.
    const again = await startImport(actor, {
      name: "otra-vez.csv",
      bytes: buildCsv(
        [
          HEADERS,
          KEYS.map(
            (key) =>
              row("EXI-1", { name: "Existe", initialStock: "1" })[key] ?? "",
          ),
        ],
        { neutralize: false },
      ),
    });
    if (!again.ok) throw new Error(again.error);
    await saveImportMapping(actor, {
      importId: again.importId,
      mapping: MAPPING,
      decimalSeparator: ".",
    });
    expect(await confirmImport(actor, again.importId)).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    expect(await balances(actor)).toEqual(["EXI-1 @ General = 15"]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});

describe("a presentation named in a later row", () => {
  it("is the product's presentation, and its stock enters with that content", async () => {
    const actor = await company(10);
    await shelf(actor);
    const importId = await confirmed(actor, [
      row("CLA-1", { initialStock: "40" }),
      row("CLA-1", {
        presentation: "Caja",
        presentationContent: "100",
        initialStock: "3",
        initialStockIn: "Caja",
        location: "Zona A › Estante 3",
      }),
    ]);
    expect(await applyImport(actor.organizationId, importId)).toMatchObject({
      ok: true,
      processed: 1,
      failed: 0,
    });
    expect((await lines(actor)).map(shape)).toEqual([
      "CLA-1 @ Estante 3: 3 × 100 = 300",
      "CLA-1 @ General: 40 × 1 = 40",
    ]);
    expect(await balances(actor)).toEqual([
      "CLA-1 @ Estante 3 = 300",
      "CLA-1 @ General = 40",
    ]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});

describe("what a file needs to be confirmed", () => {
  it("each operation of the file asks for the permission of doing it by hand", async () => {
    const actor = await company(10);
    const existing = await createProduct(actor, {
      sku: "EXI-1",
      name: "Existe",
    });
    expect(existing.ok).toBe(true);
    const importId = await confirmed(actor, [
      row("EXI-1", {
        name: "Existe",
        presentation: "Caja",
        presentationContent: "12",
      }),
      row("NUE-2", { minimum: "5", initialStock: "3" }),
    ]);
    const saved = await db.productImport.findUniqueOrThrow({
      where: { id: importId },
      select: { requiredPermissions: true },
    });
    expect(saved.requiredPermissions).toEqual([
      "inventory.import.confirm",
      "inventory.minimum.update",
      "inventory.opening.create",
      "inventory.presentation.create",
      "inventory.presentation.update",
      "inventory.product.create",
      "inventory.product.update",
    ]);
  });

  it("only what the file does is asked for", () => {
    const first = {
      row: 2,
      sku: "A",
      name: "A",
      description: null,
      category: null,
      brand: null,
      barcode: null,
      unitCode: "piece",
      presentation: null,
      stock: null,
      minimum: null,
    };
    expect(importPermissions([])).toEqual(["inventory.import.confirm"]);
    expect(
      importPermissions([{ sku: "A", kind: "new", first, rows: [first] }]),
    ).toEqual(["inventory.import.confirm", "inventory.product.create"]);
    expect(
      importPermissions([
        {
          sku: "A",
          kind: "reactivate",
          first,
          // Named in a later row: it is still what the file does.
          rows: [
            first,
            { ...first, presentation: { name: "Caja", content: "10" } },
          ],
        },
      ]),
    ).toEqual([
      "inventory.import.confirm",
      "inventory.presentation.create",
      "inventory.presentation.update",
      "inventory.product.reactivate",
    ]);
    const stocked = {
      ...first,
      stock: {
        base: "1",
        captured: "1",
        inPresentation: false,
        locationId: "x",
        locationPath: "General",
      },
    };
    expect(
      importPermissions([
        { sku: "A", kind: "update", first, rows: [first, stocked] },
      ]),
    ).toEqual([
      "inventory.import.confirm",
      "inventory.opening.create",
      "inventory.product.update",
    ]);
  });
});
