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
  EXIT_COLUMNS,
  EXIT_IMPORT_JOB_TYPE,
  applyExitImport,
  cancelExitImport,
  confirmExitImport,
  getExitCoverage,
  listExitImportFailures,
  listExitImports,
  matchExitColumns,
  parseExitDay,
  reconcileStock,
  registerEntry,
  reviewExitImport,
  startExitImport,
  validateExitRows,
  type ExitColumnKey,
  type ExitProduct,
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
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import { runNextJob, settleFailedJobs } from "@/platform/jobs";
import { archiveLocation, createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-10: daily exits from a file. The external identifier (folio) keeps
// a sale from leaving stock twice, and the system tells up to which day
// exits are imported.

const KEYS = EXIT_COLUMNS.map((column) => column.key);
const HEADERS = EXIT_COLUMNS.map((column) => column.header);
const MAPPING = Object.fromEntries(KEYS.map((key, index) => [key, index]));
type Row = Partial<Record<ExitColumnKey, string>>;
type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `salidasimp.${++counter}.${stamp}@example.test`,
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
      productLimit: 50,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de salidas importadas",
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

/** A product with stock in General. */
async function stocked(
  actor: InventoryActor,
  sku: string,
  quantity: string | null,
  extra: { barcode?: string; unit?: string } = {},
) {
  const product = await createProduct(actor, {
    sku,
    name: `Producto ${sku}`,
    ...extra,
  });
  if (!product.ok) throw new Error("product setup failed");
  if (quantity) {
    const entry = await registerEntry(actor, {
      productId: product.productId,
      quantity,
    });
    if (!entry.ok) throw new Error("stock setup failed");
  }
  return product.productId;
}

const sale = (
  externalId: string,
  sku: string,
  quantity: string,
  extra: Row = {},
): Row => ({ day: "2026-10-08", externalId, sku, quantity, ...extra });

const csv = (rows: Row[]) =>
  buildCsv(
    [HEADERS, ...rows.map((line) => KEYS.map((key) => line[key] ?? ""))],
    {
      neutralize: false,
    },
  );

async function uploaded(actor: InventoryActor, rows: Row[]) {
  const started = await startExitImport(actor, {
    name: "salidas.csv",
    bytes: csv(rows),
    decimalSeparator: ".",
  });
  if (!started.ok) throw new Error(started.error);
  return started.importId;
}

async function confirmed(actor: InventoryActor, rows: Row[]) {
  const importId = await uploaded(actor, rows);
  const result = await confirmExitImport(actor, importId);
  if (!result.ok) throw new Error(result.error);
  return importId;
}

/** Stock of the company: «SKU @ location = quantity». */
async function balances(actor: InventoryActor) {
  const rows = await db.stockBalance.findMany({
    where: { organizationId: actor.organizationId },
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

const exits = (actor: InventoryActor) =>
  db.stockMovement.findMany({
    where: { organizationId: actor.organizationId, type: "EXIT" },
    orderBy: { reference: "asc" },
    select: {
      reference: true,
      reason: true,
      idempotencyKey: true,
      createdByUserId: true,
      lines: {
        select: {
          direction: true,
          capturedQuantity: true,
          factor: true,
          baseQuantity: true,
          product: { select: { sku: true } },
        },
      },
    },
  });

const rowsOf = (importId: string) =>
  db.exitImportRow.findMany({
    where: { importId },
    orderBy: { row: "asc" },
    select: { row: true, status: true, error: true, externalId: true },
  });

beforeEach(async () => {
  // Jobs are shared by every worker: each test starts with an empty queue.
  await db.job.deleteMany({});
});
afterEach(() => {
  vi.restoreAllMocks();
  invalidateEntitlements();
});
afterAll(() => db.$disconnect());

describe("reading the file", () => {
  const product = (extra: Partial<ExitProduct> = {}): ExitProduct => ({
    id: "p1",
    sku: "TOR-1",
    name: "Tornillo",
    barcode: "750100",
    status: "ACTIVE",
    unitCode: "piece",
    quantityStep: "1",
    presentations: [{ id: "caja", name: "Caja" }],
    ...extra,
  });
  const PRODUCTS = [
    product(),
    product({
      id: "p2",
      sku: "CAB-2",
      name: "Cable",
      barcode: null,
      unitCode: "m",
      quantityStep: "0.01",
      presentations: [],
    }),
    product({
      id: "p3",
      sku: "VIE-3",
      name: "Viejo",
      barcode: null,
      status: "ARCHIVED",
    }),
  ];
  const LOCATIONS = [
    { id: "general", path: "General", isDefault: true },
    { id: "a3", path: "Zona A › Estante 3", isDefault: false },
  ];
  const check = (rows: Row[], decimalSeparator: "." | "," = ".") =>
    validateExitRows(
      rows.map((line, index) => ({
        row: index + 2,
        cells: KEYS.map((key) => line[key] ?? ""),
      })),
      {
        headers: HEADERS,
        mapping: MAPPING,
        decimalSeparator,
        today: "2026-10-10",
        products: PRODUCTS,
        locations: LOCATIONS,
      },
    );
  const problems = (rows: Row[], separator: "." | "," = ".") =>
    check(rows, separator).issues.map(
      (issue) => `${issue.row} ${issue.column}: ${issue.message}`,
    );
  const base = sale("T-1", "TOR-1", "3");

  it("understands a row: product by key or barcode, presentation, location", () => {
    const result = check([
      base,
      { ...sale("T-2", "", "2", { barcode: "750100", presentation: "caja" }) },
      sale("T-3", "cab-2", "12.5", {
        day: "09/10/2026",
        location: "zona a > estante 3",
      }),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.valid).toMatchObject([
      {
        row: 2,
        day: "2026-10-08",
        externalId: "T-1",
        productId: "p1",
        presentation: null,
        quantity: "3",
        locationId: "general",
      },
      { productId: "p1", presentation: { id: "caja" }, quantity: "2" },
      {
        productId: "p2",
        day: "2026-10-09",
        quantity: "12.5",
        locationId: "a3",
      },
    ]);
    // With decimal comma, as the person said their file comes.
    expect(check([sale("T-9", "CAB-2", "12,5")], ",").valid[0]).toMatchObject({
      quantity: "12.5",
    });
  });

  it("dates are a real day, written day first, and never in the future", () => {
    expect(parseExitDay("2026-10-09")).toBe("2026-10-09");
    expect(parseExitDay("9/10/2026")).toBe("2026-10-09");
    expect(parseExitDay("09-10-2026")).toBe("2026-10-09");
    for (const text of [
      "31/02/2026",
      "2026-13-01",
      "10/2026",
      "ayer",
      "46304",
    ]) {
      expect(parseExitDay(text), text).toBeNull();
    }
    expect(problems([{ ...base, day: "" }])).toEqual([
      "2 day: Falta la fecha en que salió.",
    ]);
    expect(problems([{ ...base, day: "13/13/2026" }])[0]).toContain(
      "No se entiende la fecha",
    );
    expect(problems([{ ...base, day: "46304" }])[0]).toContain(
      "viene como número de Excel",
    );
    expect(problems([{ ...base, day: "2026-10-11" }])).toEqual([
      "2 day: La fecha es posterior a hoy: todavía no pudo salir.",
    ]);
    expect(check([{ ...base, day: "2026-10-10" }]).issues).toEqual([]);
  });

  it("every row needs its folio, and a folio brings a product once", () => {
    expect(problems([{ ...base, externalId: "" }])[0]).toContain(
      "Falta el folio o ticket",
    );
    expect(problems([{ ...base, externalId: "x".repeat(65) }])[0]).toContain(
      "hasta 64 caracteres",
    );
    // The same ticket with another product is fine; the same product is not.
    expect(check([base, sale("T-1", "CAB-2", "1")]).issues).toEqual([]);
    expect(problems([base, sale("t-1", "tor-1", "2")])).toEqual([
      "3 externalId: El folio «t-1» ya trae TOR-1 en la fila 2. Suma las cantidades en una sola fila.",
    ]);
  });

  it("the product must exist, be active and be the one both codes name", () => {
    expect(problems([sale("T-1", "", "1")])).toEqual([
      "2 sku: Escribe la clave o el código de barras del producto.",
    ]);
    expect(problems([sale("T-1", "NO-HAY", "1")])).toEqual([
      "2 sku: No hay un producto con la clave «NO-HAY».",
    ]);
    expect(problems([sale("T-1", "", "1", { barcode: "000" })])).toEqual([
      "2 barcode: No hay un producto con ese código de barras.",
    ]);
    expect(
      problems([sale("T-1", "CAB-2", "1", { barcode: "750100" })])[0],
    ).toContain("Ese código de barras es de TOR-1, no de CAB-2");
    expect(problems([sale("T-1", "VIE-3", "1")])[0]).toContain(
      "VIE-3 está archivado",
    );
  });

  it("quantities follow the rule of the product; presentations are whole", () => {
    expect(problems([sale("T-1", "TOR-1", "")])).toEqual([
      "2 quantity: Falta la cantidad que salió.",
    ]);
    expect(problems([sale("T-1", "TOR-1", "2.5")])).toHaveLength(1);
    expect(problems([sale("T-1", "TOR-1", "0")])).toHaveLength(1);
    expect(problems([sale("T-1", "TOR-1", "-3")])).toHaveLength(1);
    expect(problems([sale("T-1", "TOR-1", "1,5")])[0]).toContain(
      "no se entiende como número con punto decimal",
    );
    expect(
      problems([sale("T-1", "TOR-1", "1.5", { presentation: "Caja" })])[0],
    ).toContain("Las presentaciones se cuentan completas");
    expect(
      problems([sale("T-1", "TOR-1", "1", { presentation: "Bolsa" })])[0],
    ).toContain("TOR-1 no tiene una presentación «Bolsa»");
    expect(
      problems([sale("T-1", "TOR-1", "1", { location: "Bodega 9" })])[0],
    ).toContain("No existe la ubicación «Bodega 9»");
  });

  it("finds the columns by their usual titles and says which are missing", () => {
    expect(
      matchExitColumns([
        "Ticket",
        "Código",
        "Fecha de venta",
        "Piezas",
        "Otra",
      ]),
    ).toEqual({
      mapping: { externalId: 0, sku: 1, day: 2, quantity: 3 },
      missing: [],
    });
    expect(matchExitColumns(["Fecha", "Cantidad"]).missing).toEqual([
      "Folio",
      "Clave (SKU) o Código de barras",
    ]);
  });
});

describe("startExitImport", () => {
  it("keeps a readable file and asks how decimals are written", async () => {
    const actor = await company();
    expect(
      await startExitImport(actor, {
        name: "salidas.csv",
        bytes: csv([sale("T-1", "X", "1")]),
        decimalSeparator: "",
      }),
    ).toMatchObject({ ok: false, reason: "separator" });
    const missing = await startExitImport(actor, {
      name: "salidas.csv",
      bytes: buildCsv([
        ["Fecha", "Cantidad"],
        ["2026-10-08", "3"],
      ]),
      decimalSeparator: ".",
    });
    expect(missing).toMatchObject({ ok: false, reason: "content" });
    expect(!missing.ok && missing.error).toContain("«Folio»");
    // Neither attempt left a file or an import behind.
    expect(
      await db.storedFile.count({
        where: { organizationId: actor.organizationId, deletedAt: null },
      }),
    ).toBe(0);
    expect(await listExitImports(actor)).toEqual([]);

    const importId = await uploaded(actor, [sale("T-1", "X", "1")]);
    expect(await listExitImports(actor)).toMatchObject([
      { id: importId, status: "READY", dataRows: 1, fileName: "salidas.csv" },
    ]);
  });

  it("only who may import, and each company sees its own", async () => {
    const actor = await company();
    await expect(
      startExitImport(await member(actor.organizationId, "viewer"), {
        name: "salidas.csv",
        bytes: csv([sale("T-1", "X", "1")]),
        decimalSeparator: ".",
      }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    const importId = await uploaded(actor, [sale("T-1", "X", "1")]);
    const theirs = await company();
    expect(await reviewExitImport(theirs, importId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await confirmExitImport(theirs, importId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await cancelExitImport(theirs, importId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await listExitImports(theirs)).toEqual([]);
  });
});

describe("registering the exits of a file", () => {
  it("takes each row out of stock as an exit and tells up to which day", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "100", { barcode: "750100" });
    await stocked(actor, "CAB-2", "50", { unit: "m" });
    expect(await getExitCoverage(actor)).toEqual({
      through: null,
      updatedAt: null,
      inProgress: 0,
      missing: 0,
    });
    const importId = await uploaded(actor, [
      sale("T-100", "TOR-1", "30", { day: "2026-10-07" }),
      sale("T-101", "", "5", { barcode: "750100" }),
      sale("T-101", "CAB-2", "12.5", { day: "09/10/2026" }),
    ]);
    const review = await reviewExitImport(actor, importId);
    expect(review).toMatchObject({
      ok: true,
      status: "READY",
      check: {
        totalRows: 3,
        validRows: 3,
        invalidRows: 0,
        alreadyImported: 0,
        toApply: 3,
        tickets: 2,
        firstDay: "2026-10-07",
        lastDay: "2026-10-09",
        ready: true,
      },
    });
    // Reviewing moved nothing.
    expect(await balances(actor)).toEqual([
      "CAB-2 @ General = 50",
      "TOR-1 @ General = 100",
    ]);

    expect(await confirmExitImport(actor, importId)).toEqual({
      ok: true,
      rows: 3,
    });
    expect((await getExitCoverage(actor)).inProgress).toBe(3);
    expect(await applyExitImport(actor.organizationId, importId)).toEqual({
      ok: true,
      status: "DONE",
      applied: 3,
      duplicates: 0,
      failed: 0,
    });
    expect(await balances(actor)).toEqual([
      "CAB-2 @ General = 37.5",
      "TOR-1 @ General = 65",
    ]);
    const written = await exits(actor);
    expect(
      written.map((movement) => [
        movement.reference,
        movement.lines[0]!.product.sku,
        movement.lines[0]!.baseQuantity.toString(),
      ]),
    ).toEqual([
      ["T-100", "TOR-1", "30"],
      ["T-101", "TOR-1", "5"],
      ["T-101", "CAB-2", "12.5"],
    ]);
    for (const movement of written) {
      expect(movement.lines).toHaveLength(1);
      expect(movement.lines[0]!.direction).toBe("OUT");
      expect(movement.createdByUserId).toBe(actor.userId);
      expect(movement.idempotencyKey).toMatch(/^exit-import:[0-9a-f-]{36}$/);
    }
    expect(written[0]!.reason).toBe(
      "Salida del 7 de octubre de 2026, importada de un archivo",
    );
    const coverage = await getExitCoverage(actor);
    expect(coverage).toMatchObject({
      through: "2026-10-09",
      inProgress: 0,
      missing: 0,
    });
    expect(coverage.updatedAt).toBeInstanceOf(Date);
    expect(await reviewExitImport(actor, importId)).toMatchObject({
      status: "DONE",
      check: null,
      progress: {
        totalRows: 3,
        appliedRows: 3,
        firstDay: "2026-10-07",
        lastDay: "2026-10-09",
      },
    });
    for (const action of [
      "inventory.exit_import_confirmed",
      "inventory.exit_import_applied",
    ]) {
      expect(
        await db.auditEvent.count({ where: { action, targetId: importId } }),
        action,
      ).toBe(1);
    }
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("the folio keeps a sale from leaving stock twice, whatever file brings it", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "100");
    await stocked(actor, "CLA-2", "100");
    const monday = [sale("T-1", "TOR-1", "10"), sale("T-2", "CLA-2", "4")];
    await applyExitImport(actor.organizationId, await confirmed(actor, monday));
    expect(await balances(actor)).toEqual([
      "CLA-2 @ General = 96",
      "TOR-1 @ General = 90",
    ]);

    // The same file again, by mistake: the review already says so.
    const again = await uploaded(actor, monday);
    expect(await reviewExitImport(actor, again)).toMatchObject({
      check: { validRows: 2, alreadyImported: 2, toApply: 0 },
    });
    await confirmExitImport(actor, again);
    expect(await applyExitImport(actor.organizationId, again)).toEqual({
      ok: true,
      status: "DONE",
      applied: 0,
      duplicates: 2,
      failed: 0,
    });
    expect(await balances(actor)).toEqual([
      "CLA-2 @ General = 96",
      "TOR-1 @ General = 90",
    ]);

    // A file that overlaps: yesterday's sales plus today's. The folio is
    // the same whatever its case, and another quantity does not make it new.
    const overlap = await confirmed(actor, [
      sale("t-1", "TOR-1", "99"),
      sale("T-2", "TOR-1", "1"),
      sale("T-3", "CLA-2", "6"),
    ]);
    expect(await applyExitImport(actor.organizationId, overlap)).toMatchObject({
      applied: 2,
      duplicates: 1,
      failed: 0,
    });
    expect((await rowsOf(overlap)).map((row) => row.status)).toEqual([
      "DUPLICATE",
      "DONE",
      "DONE",
    ]);
    expect(await balances(actor)).toEqual([
      "CLA-2 @ General = 90",
      "TOR-1 @ General = 89",
    ]);
    expect(await exits(actor)).toHaveLength(4);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("two files with the same sale, registered at once, discount it once", async () => {
    for (let round = 0; round < 3; round++) {
      const actor = await company();
      await stocked(actor, "TOR-1", "100");
      const rows = Array.from({ length: 6 }, (_, i) =>
        sale(`T-${i}`, "TOR-1", "5"),
      );
      const [first, second] = [
        await confirmed(actor, rows),
        await confirmed(actor, rows),
      ];
      const results = await Promise.all([
        applyExitImport(actor.organizationId, first, { batchSize: 2 }),
        applyExitImport(actor.organizationId, second, { batchSize: 2 }),
      ]);
      const applied = results.map((result) =>
        result.ok ? result.applied : -1,
      );
      const duplicates = results.map((result) =>
        result.ok ? result.duplicates : -1,
      );
      expect(applied[0]! + applied[1]!).toBe(6);
      expect(duplicates[0]! + duplicates[1]!).toBe(6);
      expect(await balances(actor)).toEqual(["TOR-1 @ General = 70"]);
      expect(await exits(actor)).toHaveLength(6);
      expect(await reconcileStock(actor.organizationId)).toEqual([]);
    }
  }, 120_000);

  it("a worker that dies half way continues without repeating an exit", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "100");
    const importId = await confirmed(
      actor,
      Array.from({ length: 11 }, (_, i) => sale(`T-${i}`, "TOR-1", "2")),
    );
    let batches = 0;
    await expect(
      applyExitImport(actor.organizationId, importId, {
        batchSize: 3,
        onBatch: () => {
          if (++batches === 2) throw new Error("the worker died");
        },
      }),
    ).rejects.toThrow("the worker died");
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 88"]);
    expect(await reviewExitImport(actor, importId)).toMatchObject({
      status: "RUNNING",
      progress: { appliedRows: 6 },
    });

    const results = await Promise.all([
      applyExitImport(actor.organizationId, importId, { batchSize: 2 }),
      applyExitImport(actor.organizationId, importId, { batchSize: 2 }),
    ]);
    expect(results).toEqual([
      { ok: true, status: "DONE", applied: 11, duplicates: 0, failed: 0 },
      { ok: true, status: "DONE", applied: 11, duplicates: 0, failed: 0 },
    ]);
    await applyExitImport(actor.organizationId, importId);
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 78"]);
    expect(await exits(actor)).toHaveLength(11);
    expect(
      await db.auditEvent.count({
        where: { action: "inventory.exit_import_applied", targetId: importId },
      }),
    ).toBe(1);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("stock never goes below zero: what does not fit waits for the next upload", async () => {
    const actor = await company();
    const tornillo = await stocked(actor, "TOR-1", "10");
    await stocked(actor, "CLA-2", null);
    const file = [
      sale("T-1", "TOR-1", "6"),
      sale("T-2", "TOR-1", "6", { day: "2026-10-09" }),
      sale("T-3", "CLA-2", "1"),
      sale("T-4", "TOR-1", "4"),
    ];
    const importId = await confirmed(actor, file);
    expect(await applyExitImport(actor.organizationId, importId)).toEqual({
      ok: true,
      status: "DONE",
      applied: 2,
      duplicates: 0,
      failed: 2,
    });
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 0"]);
    const failures = await listExitImportFailures(actor, importId);
    expect(failures.map((failure) => [failure.row, failure.sku])).toEqual([
      [3, "TOR-1"],
      [4, "CLA-2"],
    ]);
    expect(failures[0]!.error).toContain(
      "Solo hay 4 piezas de TOR-1 en General: no pueden salir 6 piezas",
    );
    expect(failures[1]!.error).toContain(
      "No hay existencias de CLA-2 en General",
    );
    // Up to the last day that did get in, with two sales still missing.
    expect(await getExitCoverage(actor)).toMatchObject({
      through: "2026-10-08",
      missing: 2,
    });

    // The stock is corrected and the same file uploaded again: only what
    // was missing leaves now.
    await registerEntry(actor, { productId: tornillo, quantity: "20" });
    const second = await confirmed(actor, file);
    expect(await applyExitImport(actor.organizationId, second)).toMatchObject({
      applied: 1,
      duplicates: 2,
      failed: 1,
    });
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 14"]);
    expect(await getExitCoverage(actor)).toMatchObject({
      through: "2026-10-09",
      missing: 1,
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("presentations and other locations leave like a manual exit, with today's content", async () => {
    const actor = await company();
    const zone = await createLocation(actor, { name: "Zona A", kind: "ZONE" });
    if (!zone.ok) throw new Error("zone setup failed");
    const productId = await stocked(actor, "TOR-1", null);
    const caja = await createPresentation(actor, productId, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    await registerEntry(actor, {
      productId,
      quantity: "500",
      locationId: zone.locationId,
    });
    const importId = await confirmed(actor, [
      sale("T-1", "TOR-1", "2", { presentation: "caja", location: "Zona A" }),
    ]);
    // The box changes before the worker registers it: an exit converts
    // with the product as it is when it is registered.
    await changePresentationFactor(actor, caja.presentationId, {
      factor: "120",
      reason: "Cambio de empaque",
    });
    expect(await applyExitImport(actor.organizationId, importId)).toMatchObject(
      {
        applied: 1,
        failed: 0,
      },
    );
    expect(await balances(actor)).toEqual(["TOR-1 @ Zona A = 260"]);
    const [movement] = await exits(actor);
    expect(movement!.lines[0]).toMatchObject({ direction: "OUT" });
    expect(
      [
        movement!.lines[0]!.capturedQuantity,
        movement!.lines[0]!.factor,
        movement!.lines[0]!.baseQuantity,
      ].map(String),
    ).toEqual(["2", "120", "240"]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("what was archived after confirming is not registered; the rest goes on", async () => {
    const actor = await company();
    const zone = await createLocation(actor, { name: "Zona A", kind: "ZONE" });
    if (!zone.ok) throw new Error("zone setup failed");
    const gone = await stocked(actor, "ARC-1", null);
    await stocked(actor, "ZON-2", null);
    await stocked(actor, "TOR-3", "10");
    const importId = await confirmed(actor, [
      sale("T-1", "ARC-1", "1"),
      sale("T-2", "ZON-2", "1", { location: "Zona A" }),
      sale("T-3", "TOR-3", "1"),
    ]);
    expect((await archiveProduct(actor, gone)).ok).toBe(true);
    expect((await archiveLocation(actor, zone.locationId)).ok).toBe(true);
    expect(await applyExitImport(actor.organizationId, importId)).toMatchObject(
      {
        applied: 1,
        failed: 2,
      },
    );
    const rows = await rowsOf(importId);
    expect(rows.map((row) => row.status)).toEqual(["FAILED", "FAILED", "DONE"]);
    expect(rows[0]!.error).toContain("ARC-1 se archivó");
    expect(rows[1]!.error).toContain("«Zona A» se archivó");
    expect(await balances(actor)).toEqual(["TOR-3 @ General = 9"]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("a file with problems is not confirmed, and nothing leaves stock", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "10");
    const importId = await uploaded(actor, [
      sale("T-1", "TOR-1", "2"),
      sale("T-2", "NO-HAY", "1"),
    ]);
    expect(await reviewExitImport(actor, importId)).toMatchObject({
      check: { validRows: 1, invalidRows: 1, issueCount: 1, ready: false },
    });
    expect(await confirmExitImport(actor, importId)).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    expect(await applyExitImport(actor.organizationId, importId)).toEqual({
      ok: false,
      reason: "not_confirmed",
    });
    expect(await db.job.count()).toBe(0);
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 10"]);
  });
});

describe("who may, and in which company", () => {
  it("confirming needs the permission to register exits; cancelling, its own", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "10");
    const importId = await uploaded(actor, [sale("T-1", "TOR-1", "2")]);
    for (const role of ["viewer", "buyer"] as const) {
      const person = await member(actor.organizationId, role);
      await expect(confirmExitImport(person, importId)).rejects.toMatchObject({
        kind: "forbidden",
      });
      await expect(cancelExitImport(person, importId)).rejects.toMatchObject({
        kind: "forbidden",
      });
    }
    expect(await reviewExitImport(actor, importId)).toMatchObject({
      status: "READY",
    });
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(await confirmExitImport(warehouse, importId)).toEqual({
      ok: true,
      rows: 1,
    });
    // Twice confirms once: one set of rows, one job.
    expect(await confirmExitImport(warehouse, importId)).toEqual({
      ok: true,
      rows: 1,
      repeated: true,
    });
    expect(await db.exitImportRow.count({ where: { importId } })).toBe(1);
    expect(await db.job.count()).toBe(1);
  });

  it("if whoever confirmed can no longer register exits, what is pending is not registered (NEG-20)", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "100");
    const warehouse = await member(actor.organizationId, "warehouse");
    const importId = await confirmed(
      warehouse,
      Array.from({ length: 6 }, (_, i) => sale(`T-${i}`, "TOR-1", "1")),
    );
    await expect(
      applyExitImport(actor.organizationId, importId, {
        batchSize: 2,
        onBatch: () => {
          throw new Error("the worker died");
        },
      }),
    ).rejects.toThrow("the worker died");
    await db.membershipRole.deleteMany({
      where: { membership: { userId: warehouse.userId } },
    });
    expect(await runNextJob(jobHandlers, { workerId: "test" })).toMatchObject({
      kind: "done",
    });
    const review = await reviewExitImport(actor, importId);
    expect(review).toMatchObject({
      status: "FAILED",
      progress: { appliedRows: 2, totalRows: 6 },
    });
    expect(review.ok && review.progress.lastError).toContain(
      "ya no puede registrar salidas",
    );
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 98"]);
    expect(
      await db.auditEvent.findFirst({
        where: {
          action: "inventory.exit_import_failed",
          targetId: importId,
        },
      }),
    ).toMatchObject({ actorUserId: null });
  }, 60_000);

  it("the job works in the company it belongs to, whatever its payload says", async () => {
    const ours = await company();
    const theirs = await company();
    await stocked(ours, "TOR-1", "10");
    const importId = await confirmed(ours, [sale("T-1", "TOR-1", "2")]);
    await db.job.deleteMany({});
    await db.job.create({
      data: {
        id: newId(),
        organizationId: theirs.organizationId,
        type: EXIT_IMPORT_JOB_TYPE,
        payload: { importId, organizationId: ours.organizationId },
        maxAttempts: 1,
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runNextJob(jobHandlers, { workerId: "test" })).toMatchObject({
      kind: "failed",
    });
    // Settling that failure does not touch our import either.
    await settleFailedJobs(jobHandlers);
    expect(await balances(ours)).toEqual(["TOR-1 @ General = 10"]);
    expect(await reviewExitImport(ours, importId)).toMatchObject({
      status: "CONFIRMED",
    });
  });
});

describe("through the queue, and stopping", () => {
  it("confirming queues the work and the worker registers it", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "10");
    const importId = await confirmed(actor, [sale("T-1", "TOR-1", "2")]);
    expect(await db.job.findMany({})).toMatchObject([
      {
        type: EXIT_IMPORT_JOB_TYPE,
        status: "PENDING",
        payload: { importId },
        organizationId: actor.organizationId,
        createdByUserId: actor.userId,
      },
    ]);
    expect(await runNextJob(jobHandlers, { workerId: "test" })).toMatchObject({
      kind: "done",
    });
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 8"]);
  });

  it("cancelling leaves what was registered and registers nothing more", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "100");
    const importId = await confirmed(
      actor,
      Array.from({ length: 6 }, (_, i) => sale(`T-${i}`, "TOR-1", "1")),
    );
    await expect(
      applyExitImport(actor.organizationId, importId, {
        batchSize: 2,
        onBatch: () => {
          throw new Error("the worker died");
        },
      }),
    ).rejects.toThrow("the worker died");
    expect(await cancelExitImport(actor, importId)).toEqual({
      ok: true,
      applied: 2,
      pending: 4,
    });
    expect(await cancelExitImport(actor, importId)).toEqual({
      ok: true,
      applied: 2,
      pending: 4,
      repeated: true,
    });
    expect(await applyExitImport(actor.organizationId, importId)).toEqual({
      ok: false,
      reason: "stopped",
    });
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 98"]);
    expect(await confirmExitImport(actor, importId)).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    // The sales that did not get in can be uploaded again later.
    const later = await confirmed(
      actor,
      Array.from({ length: 6 }, (_, i) => sale(`T-${i}`, "TOR-1", "1")),
    );
    expect(await applyExitImport(actor.organizationId, later)).toMatchObject({
      applied: 4,
      duplicates: 2,
    });
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 94"]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("a job that fails for good leaves the import as failed, with what is left", async () => {
    const actor = await company();
    await stocked(actor, "TOR-1", "100");
    const importId = await confirmed(
      actor,
      Array.from({ length: 5 }, (_, i) => sale(`T-${i}`, "TOR-1", "1")),
    );
    await db.job.updateMany({ data: { maxAttempts: 1 } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      [EXIT_IMPORT_JOB_TYPE]: {
        ...jobHandlers[EXIT_IMPORT_JOB_TYPE]!,
        handle: async (context: { organizationId: string }) =>
          applyExitImport(context.organizationId, importId, {
            batchSize: 2,
            onBatch: () => {
              throw new Error("se cayó la conexión");
            },
          }),
      },
    };
    expect(await runNextJob(broken, { workerId: "test" })).toMatchObject({
      kind: "failed",
    });
    expect(await settleFailedJobs(broken)).toEqual({ settled: 1, pending: 0 });
    const review = await reviewExitImport(actor, importId);
    expect(review).toMatchObject({
      status: "FAILED",
      progress: { appliedRows: 2 },
    });
    expect(review.ok && review.progress.lastError).toContain(
      "Faltan 3 salidas por registrar",
    );
    expect(await balances(actor)).toEqual(["TOR-1 @ General = 98"]);
  }, 60_000);
});
