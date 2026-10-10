import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { newId } from "@/lib";
import {
  IMPORT_COLUMNS,
  IMPORT_JOB_TYPE,
  applyImport,
  confirmImport,
  getImport,
  getMinimum,
  saveImportMapping,
  startImport,
  type ImportColumnKey,
  type InventoryActor,
} from "@/modules/inventory";
import { jobHandlers } from "@/modules/registry/jobs";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  changePresentationFactor,
  createPresentation,
  createProduct,
  listPresentations,
} from "@/platform/catalog";
import { getQuotaUsage, invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import { runNextJob } from "@/platform/jobs";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-08: the worker applies a confirmed import in batches. Retrying the
// job does not duplicate products; factors are fixed when confirming.

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
      email: `aplicarimp.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de aplicar importación",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

const row = (sku: string, extra: Row = {}): Row => ({
  sku,
  name: `Producto ${sku}`,
  unit: "pieza",
  ...extra,
});

/** An import of the given rows, confirmed and waiting for the worker. */
async function confirmed(owner: InventoryActor, rows: Row[]) {
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
  const result = await confirmImport(owner, started.importId);
  if (!result.ok) throw new Error(result.error);
  return started.importId;
}

const products = (owner: InventoryActor) =>
  db.product.findMany({
    where: { organizationId: owner.organizationId },
    orderBy: { sku: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      status: true,
      unitCode: true,
      barcode: true,
      description: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });

const usage = (owner: InventoryActor) =>
  getQuotaUsage(owner.organizationId, "active_products");

beforeEach(async () => {
  // Jobs are shared by every worker: each test starts with an empty queue.
  await db.job.deleteMany({});
});
afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("applyImport", () => {
  it("creates, updates and reactivates the products of the file", async () => {
    const actor = await company(10);
    const existing = await createProduct(actor, {
      sku: "TOR-1",
      name: "Tornillo",
      barcode: "750100",
      brand: "Fiero",
      description: "Descripción que se queda",
    });
    const archived = await createProduct(actor, {
      sku: "VIE-2",
      name: "Viejo",
    });
    if (!existing.ok || !archived.ok) throw new Error("product setup failed");
    await archiveProduct(actor, archived.productId);

    const importId = await confirmed(actor, [
      row("tor-1", { name: "Tornillo hexagonal", brand: "Truper" }),
      row("VIE-2", { name: "Viejo que vuelve" }),
      row("NUE-3", {
        name: "Cable nuevo",
        unit: "metro",
        category: "Eléctrico",
        barcode: "750300",
        description: "THW calibre 12",
        minimum: "50",
      }),
    ]);
    expect(await usage(actor)).toMatchObject({ used: 1, reserved: 2 });

    expect(await applyImport(actor.organizationId, importId)).toEqual({
      ok: true,
      status: "DONE",
      processed: 3,
      failed: 0,
    });
    const catalog = await products(actor);
    expect(catalog.map((p) => [p.sku, p.name, p.status])).toEqual([
      ["NUE-3", "Cable nuevo", "ACTIVE"],
      ["TOR-1", "Tornillo hexagonal", "ACTIVE"],
      ["VIE-2", "Viejo que vuelve", "ACTIVE"],
    ]);
    expect(catalog[0]).toMatchObject({
      unitCode: "m",
      barcode: "750300",
      description: "THW calibre 12",
      category: { name: "Eléctrico" },
    });
    // Empty cells erased nothing of the product that existed.
    expect(catalog[1]).toMatchObject({
      id: existing.productId,
      barcode: "750100",
      description: "Descripción que se queda",
      brand: { name: "Truper" },
    });
    expect(await getMinimum(actor, catalog[0]!.id)).toBe("50");
    // The places that were held are now used; none is left held.
    expect(await usage(actor)).toEqual({
      limit: 10,
      used: 3,
      reserved: 0,
      available: 7,
    });
    expect(await getImport(actor, importId)).toMatchObject({
      status: "DONE",
      reservedPlaces: 0,
      totalItems: 3,
      processedItems: 3,
      failedItems: 0,
    });
    const audit = await db.auditEvent.findFirst({
      where: {
        organizationId: actor.organizationId,
        action: "inventory.import_applied",
        targetId: importId,
      },
    });
    expect(audit).toMatchObject({ actorUserId: actor.userId });
  });

  it("works in batches and can be run again without repeating anything", async () => {
    const actor = await company(40);
    const importId = await confirmed(
      actor,
      Array.from({ length: 23 }, (_, i) =>
        row(`P-${String(i).padStart(2, "0")}`),
      ),
    );
    let batches = 0;
    // The worker dies after the second batch.
    await expect(
      applyImport(actor.organizationId, importId, {
        batchSize: 5,
        onBatch: () => {
          if (++batches === 2) throw new Error("the worker died");
        },
      }),
    ).rejects.toThrow("the worker died");
    expect((await products(actor)).length).toBe(10);
    expect(await getImport(actor, importId)).toMatchObject({
      status: "RUNNING",
      processedItems: 10,
      reservedPlaces: 13,
    });
    expect(await usage(actor)).toMatchObject({ used: 10, reserved: 13 });

    // Another run continues where it stopped.
    expect(
      await applyImport(actor.organizationId, importId, { batchSize: 5 }),
    ).toMatchObject({ ok: true, processed: 23, failed: 0 });
    const catalog = await products(actor);
    expect(catalog).toHaveLength(23);
    expect(new Set(catalog.map((p) => p.sku)).size).toBe(23);
    expect(await usage(actor)).toMatchObject({ used: 23, reserved: 0 });

    // And once done, running again changes nothing.
    expect(await applyImport(actor.organizationId, importId)).toMatchObject({
      ok: true,
      processed: 23,
    });
    expect(await products(actor)).toHaveLength(23);
    expect(await usage(actor)).toMatchObject({ used: 23, reserved: 0 });
    expect(
      await db.auditEvent.count({
        where: { action: "inventory.import_applied", targetId: importId },
      }),
    ).toBe(1);
  }, 60_000);

  it("two workers on the same import create each product once", async () => {
    const actor = await company(40);
    const importId = await confirmed(
      actor,
      Array.from({ length: 20 }, (_, i) => row(`D-${i}`)),
    );
    const results = await Promise.all([
      applyImport(actor.organizationId, importId, { batchSize: 3 }),
      applyImport(actor.organizationId, importId, { batchSize: 3 }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await products(actor)).toHaveLength(20);
    expect(await usage(actor)).toMatchObject({ used: 20, reserved: 0 });
    expect(await getImport(actor, importId)).toMatchObject({
      status: "DONE",
      processedItems: 20,
    });
  }, 60_000);

  it("the content of a presentation is the one confirmed", async () => {
    const actor = await company(10);
    const existing = await createProduct(actor, {
      sku: "TOR-1",
      name: "Tornillo",
    });
    if (!existing.ok) throw new Error("product setup failed");
    const caja = await createPresentation(actor, existing.productId, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");

    const importId = await confirmed(actor, [
      // The file says the box now brings 120.
      row("TOR-1", {
        name: "Tornillo",
        presentation: "Caja",
        presentationContent: "120",
      }),
      row("CLA-2", { presentation: "Bolsa", presentationContent: "50" }),
    ]);
    // Someone changes the box by hand before the worker gets to it.
    await changePresentationFactor(actor, caja.presentationId, {
      factor: "144",
      reason: "Cambio manual",
    });
    await applyImport(actor.organizationId, importId);

    const boxes = await listPresentations(actor, existing.productId);
    // What was confirmed wins: a new version with 120, history intact.
    expect(boxes.map((p) => [p.name, p.factor])).toEqual([["Caja", "120"]]);
    const versions = await db.presentationVersion.findMany({
      where: { presentationId: caja.presentationId },
      orderBy: { version: "asc" },
      select: { version: true, factor: true },
    });
    expect(versions.map((v) => [v.version, v.factor.toString()])).toEqual([
      [1, "100"],
      [2, "144"],
      [3, "120"],
    ]);
    const clavo = (await products(actor)).find((p) => p.sku === "CLA-2")!;
    expect(
      (await listPresentations(actor, clavo.id)).map((p) => [p.name, p.factor]),
    ).toEqual([["Bolsa", "50"]]);

    // The same content again does not add a version.
    const again = await confirmed(actor, [
      row("TOR-1", {
        name: "Tornillo",
        presentation: "Caja",
        presentationContent: "120",
      }),
    ]);
    await applyImport(actor.organizationId, again);
    expect(
      await db.presentationVersion.count({
        where: { presentationId: caja.presentationId },
      }),
    ).toBe(3);
  });

  it("what changed in the file or the catalog after confirming does not matter", async () => {
    const actor = await company(10);
    const importId = await confirmed(actor, [row("A-1"), row("A-2")]);
    // The stored file disappears: the import no longer needs it.
    await db.storedFile.updateMany({
      where: { organizationId: actor.organizationId },
      data: { deletedAt: new Date() },
    });
    // And one of its products is created by hand meanwhile.
    const manual = await createProduct(actor, { sku: "A-1", name: "A mano" });
    expect(manual.ok).toBe(true);
    expect(await usage(actor)).toMatchObject({ used: 1, reserved: 2 });

    expect(await applyImport(actor.organizationId, importId)).toMatchObject({
      ok: true,
      processed: 2,
      failed: 0,
    });
    const catalog = await products(actor);
    // It became an update: one product, not two.
    expect(catalog.map((p) => [p.sku, p.name])).toEqual([
      ["A-1", "Producto A-1"],
      ["A-2", "Producto A-2"],
    ]);
    // The place it no longer needed went back to the plan.
    expect(await usage(actor)).toEqual({
      limit: 10,
      used: 2,
      reserved: 0,
      available: 8,
    });
  });

  it("a product that cannot be applied is marked; the rest go on", async () => {
    const actor = await company(10);
    const importId = await confirmed(actor, [
      row("B-1", { barcode: "750777" }),
      row("B-2"),
      row("B-3"),
    ]);
    // After confirming, someone takes that barcode and changes a unit.
    const thief = await createProduct(actor, {
      sku: "OTRO",
      name: "Otro",
      barcode: "750777",
    });
    const clash = await createProduct(actor, {
      sku: "B-3",
      name: "B-3",
      unit: "m",
    });
    expect(thief.ok && clash.ok).toBe(true);

    expect(await applyImport(actor.organizationId, importId)).toEqual({
      ok: true,
      status: "DONE",
      processed: 3,
      failed: 2,
    });
    const items = await db.productImportItem.findMany({
      where: { importId },
      orderBy: { position: "asc" },
      select: { sku: true, status: true, error: true },
    });
    expect(items.map((item) => [item.sku, item.status])).toEqual([
      ["B-1", "FAILED"],
      ["B-2", "DONE"],
      ["B-3", "FAILED"],
    ]);
    expect(items[0]!.error).toContain("código de barras");
    expect(items[2]!.error).toContain("otra unidad");
    expect((await products(actor)).map((p) => p.sku)).toEqual([
      "B-2",
      "B-3",
      "OTRO",
    ]);
    // Three were held, one was used; the other two went back.
    expect(await usage(actor)).toMatchObject({ used: 3, reserved: 0 });
    expect(await getImport(actor, importId)).toMatchObject({
      status: "DONE",
      failedItems: 2,
    });
  });

  it("only confirmed imports of the company are applied", async () => {
    const actor = await company(10);
    const started = await startImport(actor, {
      name: "sin-confirmar.csv",
      bytes: buildCsv([HEADERS, KEYS.map((key) => row("X-1")[key] ?? "")]),
    });
    if (!started.ok) throw new Error(started.error);
    expect(await applyImport(actor.organizationId, started.importId)).toEqual({
      ok: false,
      reason: "not_confirmed",
    });
    const importId = await confirmed(actor, [row("X-2")]);
    const theirs = await company(10);
    expect(await applyImport(theirs.organizationId, importId)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await products(actor)).toEqual([]);
    expect(await products(theirs)).toEqual([]);
  });
});

describe("through the queue", () => {
  it("confirming queues the work and the worker applies it", async () => {
    const actor = await company(10);
    const importId = await confirmed(actor, [row("Q-1"), row("Q-2")]);
    const jobs = await db.job.findMany({
      where: { organizationId: actor.organizationId },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: IMPORT_JOB_TYPE,
      status: "PENDING",
      payload: { importId },
      createdByUserId: actor.userId,
    });
    // Confirming again does not queue it twice.
    await confirmImport(actor, importId);
    expect(await db.job.count()).toBe(1);

    const outcome = await runNextJob(jobHandlers, { workerId: "test" });
    expect(outcome).toMatchObject({
      kind: "done",
      organizationId: actor.organizationId,
    });
    expect((await products(actor)).map((p) => p.sku)).toEqual(["Q-1", "Q-2"]);
    expect((await getImport(actor, importId))!.status).toBe("DONE");
  });

  it("a job that fails midway is retried and duplicates nothing", async () => {
    const actor = await company(40);
    const importId = await confirmed(
      actor,
      Array.from({ length: 12 }, (_, i) => row(`R-${i}`)),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const flaky = {
      [IMPORT_JOB_TYPE]: {
        retryDelayMs: () => 0,
        handle: async (context: { organizationId: string }) => {
          calls++;
          return applyImport(context.organizationId, importId, {
            batchSize: 5,
            onBatch: () => {
              if (calls === 1) throw new Error("se cayó la conexión");
            },
          });
        },
      },
    };
    expect(await runNextJob(flaky, { workerId: "test" })).toMatchObject({
      kind: "retry",
      error: "se cayó la conexión",
    });
    expect(await products(actor)).toHaveLength(5);
    expect(await runNextJob(flaky, { workerId: "test" })).toMatchObject({
      kind: "done",
    });
    expect(await products(actor)).toHaveLength(12);
    expect(await usage(actor)).toMatchObject({ used: 12, reserved: 0 });
  }, 60_000);

  it("the job works in the company it belongs to, whatever its payload says", async () => {
    const ours = await company(10);
    const theirs = await company(10);
    const importId = await confirmed(ours, [row("Z-1")]);
    await db.job.deleteMany({});
    // A job of another company naming our import.
    await db.job.create({
      data: {
        id: newId(),
        organizationId: theirs.organizationId,
        type: IMPORT_JOB_TYPE,
        payload: { importId, organizationId: ours.organizationId },
        maxAttempts: 1,
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runNextJob(jobHandlers, { workerId: "test" })).toMatchObject({
      kind: "failed",
    });
    expect(await products(ours)).toEqual([]);
    expect(await products(theirs)).toEqual([]);
    expect((await getImport(ours, importId))!.status).toBe("CONFIRMED");
  });
});
