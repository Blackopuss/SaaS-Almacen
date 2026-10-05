import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  buildImportTemplate,
  getImport,
  listImports,
  normalizeDecimal,
  saveImportMapping,
  startImport,
  suggestMapping,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-04: reading and mapping of columns. The decimal separator is the
// person's explicit answer; nothing in the file is run.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `importar.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de importación",
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

/** An import started from rows written as CSV. */
async function started(
  owner: InventoryActor,
  rows: string[][],
  name = "mio.csv",
) {
  const result = await startImport(owner, { name, bytes: buildCsv(rows) });
  if (!result.ok) throw new Error(`import not started: ${result.error}`);
  return result.importId;
}

const OWN = [
  ["Código", "Artículo", "UM", "Existencia", "Piezas por caja", "Empaque"],
  ["TOR-1", "Tornillo", "pieza", "1.234,5", "100", "Caja"],
  ["CAB-2", "Cable", "metro", "2,75", "", ""],
];

let actor: InventoryActor;

beforeAll(async () => {
  actor = await company();
}, 60_000);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("normalizeDecimal", () => {
  it("reads numbers with the separator the person chose", () => {
    const point = (text: string) => normalizeDecimal(text, ".");
    const comma = (text: string) => normalizeDecimal(text, ",");
    expect(point("2.75")).toEqual({ ok: true, value: "2.75" });
    expect(point(" 1,234.5 ")).toEqual({ ok: true, value: "1234.5" });
    expect(point("1,234,567")).toEqual({ ok: true, value: "1234567" });
    expect(point("100")).toEqual({ ok: true, value: "100" });
    expect(point("-3")).toEqual({ ok: true, value: "-3" });
    expect(comma("2,75")).toEqual({ ok: true, value: "2.75" });
    expect(comma("1.234,5")).toEqual({ ok: true, value: "1234.5" });
    expect(comma("1 234,5")).toEqual({ ok: true, value: "1234.5" });
    expect(comma("100")).toEqual({ ok: true, value: "100" });
  });

  it("refuses what would have to be guessed", () => {
    // With a decimal point, «1,5» is neither 1.5 nor 15.
    for (const text of [
      "1,5",
      "2,75",
      "1,23,4",
      "1.2.3",
      "12abc",
      "1e3",
      "",
      ".5",
      "5.",
    ]) {
      expect(normalizeDecimal(text, "."), text).toMatchObject({ ok: false });
    }
    for (const text of ["1.5", "2.75", "1,2,3", "1.23,4"]) {
      expect(normalizeDecimal(text, ","), text).toMatchObject({ ok: false });
    }
    // The same text is a different number with each separator: never guessed.
    expect(normalizeDecimal("1.234", ".")).toEqual({
      ok: true,
      value: "1.234",
    });
    expect(normalizeDecimal("1.234", ",")).toEqual({ ok: true, value: "1234" });
  });
});

describe("suggestMapping", () => {
  it("matches the titles of the template exactly", async () => {
    const template = await buildImportTemplate(actor, "csv");
    const importId = (await startImport(actor, {
      name: template.name,
      bytes: template.bytes,
    })) as { ok: true; importId: string };
    const detail = await getImport(actor, importId.importId);
    expect(detail!.mapping).toEqual({
      sku: 0,
      name: 1,
      description: 2,
      category: 3,
      brand: 4,
      barcode: 5,
      unit: 6,
      presentation: 7,
      presentationContent: 8,
      initialStock: 9,
      initialStockIn: 10,
      location: 11,
      minimum: 12,
    });
  });

  it("recognizes usual names, without accents or case, and leaves the rest", () => {
    expect(
      suggestMapping([
        "CÓDIGO",
        "  Artículo ",
        "U.M.",
        "Existencia",
        "Precio",
        "",
        "Código de Barras",
      ]),
    ).toEqual({ sku: 0, name: 1, initialStock: 3, barcode: 6 });
    // «Descripción» is the description, not a second name.
    expect(suggestMapping(["Descripción", "Nombre", "Clave"])).toEqual({
      description: 0,
      name: 1,
      sku: 2,
    });
  });
});

describe("startImport", () => {
  it("keeps the file, reads it and proposes the map", async () => {
    const importId = await started(actor, OWN, "Mi inventario.csv");
    const detail = await getImport(actor, importId);
    expect(detail).toMatchObject({
      status: "MAPPING",
      fileName: "Mi inventario.csv",
      sheetName: null,
      headerRow: 1,
      headers: OWN[0],
      dataRows: 2,
      formulaCells: 0,
      mapping: {
        sku: 0,
        name: 1,
        unit: 2,
        initialStock: 3,
        presentationContent: 4,
        presentation: 5,
      },
      // Never assumed.
      decimalSeparator: null,
      numbers: [],
    });
    expect(detail!.preview).toEqual([
      { row: 2, cells: OWN[1] },
      { row: 3, cells: OWN[2] },
    ]);
    const row = await db.productImport.findUniqueOrThrow({
      where: { id: importId },
      include: { file: true },
    });
    expect(row.file).toMatchObject({
      purpose: "import_source",
      organizationId: actor.organizationId,
      deletedAt: null,
    });
    expect(row.createdByUserId).toBe(actor.userId);
  });

  it("reads a workbook saved by Excel, formulas as stored values", async () => {
    const bytes = readFileSync(
      path.join(process.cwd(), "tests/fixtures/excel-real.xlsx"),
    );
    const result = await startImport(actor, { name: "real.xlsx", bytes });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = await getImport(actor, result.importId);
    expect(detail).toMatchObject({
      sheetName: "Productos",
      dataRows: 3,
      formulaCells: 1,
      mapping: { sku: 0, name: 1, unit: 2, presentation: 3, minimum: 7 },
    });
    // Row numbers are those of the file: row 4 is empty and skipped.
    expect(detail!.preview.map((line) => line.row)).toEqual([2, 3, 5]);
    expect(detail!.preview[0]!.cells[7]).toBe("200");
  });

  it("titles need not be on the first line", async () => {
    const importId = await started(
      actor,
      [[], ["Inventario de marzo"].concat([]), ...OWN].slice(2),
    );
    expect((await getImport(actor, importId))!.headerRow).toBe(1);
    const lower = await started(actor, [[], [], ...OWN]);
    const detail = await getImport(actor, lower);
    expect(detail).toMatchObject({ headerRow: 3, dataRows: 2 });
    expect(detail!.preview[0]!.row).toBe(4);
  });

  it("refuses files it cannot use, and keeps nothing of them", async () => {
    const files = () =>
      db.storedFile.count({
        where: { organizationId: actor.organizationId, deletedAt: null },
      });
    const imports = () =>
      db.productImport.count({
        where: { organizationId: actor.organizationId },
      });
    const before = [await files(), await imports()];
    const attempt = (name: string, bytes: Uint8Array) =>
      startImport(actor, { name, bytes });
    expect(await attempt("lista.pdf", Buffer.from("x"))).toMatchObject({
      ok: false,
      reason: "file",
    });
    expect(
      await attempt("lista.xlsx", Buffer.from("no soy excel, lo juro")),
    ).toMatchObject({ ok: false, reason: "content" });
    expect(
      await attempt("solo-titulos.csv", buildCsv([["Clave", "Nombre"]])),
    ).toMatchObject({ ok: false, reason: "content" });
    expect(
      await attempt("una-columna.csv", buildCsv([["Clave"], ["TOR-1"]])),
    ).toMatchObject({ ok: false, reason: "content" });
    expect(
      await attempt(
        "repetidos.csv",
        buildCsv([
          ["Clave", "Nombre", "nombre"],
          ["TOR-1", "a", "b"],
        ]),
      ),
    ).toMatchObject({ ok: false, reason: "content" });
    expect([await files(), await imports()]).toEqual(before);
  });

  it("a formula in a CSV is only text", async () => {
    const importId = await started(actor, [
      ["Clave", "Nombre", "Unidad"],
      ["=1+1", '=HYPERLINK("http://malo.example")', "pieza"],
    ]);
    const detail = await getImport(actor, importId);
    // buildCsv neutralizes on the way out; what matters is that reading
    // never computes: the cell is still the text that was written.
    expect(detail!.preview[0]!.cells[0]).toBe("'=1+1");
    expect(detail!.formulaCells).toBe(0);
  });
});

describe("saveImportMapping", () => {
  const full = { sku: "0", name: "1", unit: "2", initialStock: "3" };

  it("asks for the decimal separator: it has no default", async () => {
    const importId = await started(actor, OWN);
    for (const decimalSeparator of [undefined, "", ";", "punto", null]) {
      const result = await saveImportMapping(actor, {
        importId,
        mapping: full,
        decimalSeparator,
      });
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      if (result.ok) return;
      expect(result.fieldErrors.decimalSeparator).toContain("decimales");
    }
    expect(await getImport(actor, importId)).toMatchObject({
      status: "MAPPING",
      decimalSeparator: null,
    });
  });

  it("saves the map and shows how the numbers are read with it", async () => {
    const importId = await started(actor, OWN);
    expect(
      await saveImportMapping(actor, {
        importId,
        mapping: { ...full, presentation: "5", presentationContent: "4" },
        decimalSeparator: ",",
      }),
    ).toEqual({ ok: true });
    const detail = await getImport(actor, importId);
    expect(detail).toMatchObject({
      status: "READY",
      decimalSeparator: ",",
      mapping: {
        sku: 0,
        name: 1,
        unit: 2,
        initialStock: 3,
        presentation: 5,
        presentationContent: 4,
      },
    });
    expect(detail!.numbers).toEqual([
      {
        column: "presentationContent",
        header: "Contenido de la presentación",
        samples: [{ row: 2, text: "100", value: "100" }],
      },
      {
        column: "initialStock",
        header: "Existencia inicial",
        samples: [
          { row: 2, text: "1.234,5", value: "1234.5" },
          { row: 3, text: "2,75", value: "2.75" },
        ],
      },
    ]);

    // The wrong separator shows at once: those numbers cannot be read.
    await saveImportMapping(actor, {
      importId,
      mapping: full,
      decimalSeparator: ".",
    });
    const wrong = await getImport(actor, importId);
    expect(wrong!.numbers[0]!.samples).toEqual([
      { row: 2, text: "1.234,5", value: null },
      { row: 3, text: "2,75", value: null },
    ]);
  });

  it("required columns must be matched, each file column once", async () => {
    const importId = await started(actor, OWN);
    const missing = await saveImportMapping(actor, {
      importId,
      mapping: { sku: "0", name: "", initialStock: "3" },
      decimalSeparator: ".",
    });
    expect(missing).toMatchObject({ ok: false });
    if (missing.ok) return;
    expect(Object.keys(missing.fieldErrors).sort()).toEqual(["name", "unit"]);

    const twice = await saveImportMapping(actor, {
      importId,
      mapping: { sku: "0", name: "0", unit: "2" },
      decimalSeparator: ".",
    });
    expect(twice).toMatchObject({ ok: false });
    if (twice.ok) return;
    expect(twice.fieldErrors.name).toContain("ya la elegiste");

    const outside = await saveImportMapping(actor, {
      importId,
      mapping: { sku: "0", name: "1", unit: "99", brand: "-1", barcode: "x" },
      decimalSeparator: ".",
    });
    expect(outside).toMatchObject({ ok: false });
    if (outside.ok) return;
    expect(Object.keys(outside.fieldErrors).sort()).toEqual([
      "barcode",
      "brand",
      "unit",
    ]);

    const half = await saveImportMapping(actor, {
      importId,
      mapping: { sku: "0", name: "1", unit: "2", presentation: "5" },
      decimalSeparator: ".",
    });
    expect(half).toMatchObject({ ok: false });
    if (half.ok) return;
    expect(half.fieldErrors.presentationContent).toContain("van juntos");
    expect((await getImport(actor, importId))!.status).toBe("MAPPING");
  });

  it("changes nothing of the catalog", async () => {
    const importId = await started(actor, OWN);
    await saveImportMapping(actor, {
      importId,
      mapping: full,
      decimalSeparator: ",",
    });
    expect(
      await db.product.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(0);
    expect(
      await db.stockMovement.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(0);
  });
});

describe("who and which company", () => {
  it("another company neither sees nor maps this one's import", async () => {
    const importId = await started(actor, OWN);
    const theirs = await company();
    expect(await getImport(theirs, importId)).toBeNull();
    expect(await listImports(theirs)).toEqual([]);
    expect(
      await saveImportMapping(theirs, {
        importId,
        mapping: { sku: "0", name: "1", unit: "2" },
        decimalSeparator: ".",
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect((await getImport(actor, importId))!.status).toBe("MAPPING");
    expect((await listImports(actor)).map((item) => item.id)).toContain(
      importId,
    );
  });

  it("only who may import starts, reads and maps", async () => {
    const importId = await started(actor, OWN);
    const denied = { code: "permission_denied" };
    for (const role of ["viewer", "buyer"] as const) {
      const person = await member(actor.organizationId, role);
      await expect(
        startImport(person, { name: "a.csv", bytes: buildCsv(OWN) }),
      ).rejects.toMatchObject(denied);
      await expect(getImport(person, importId)).rejects.toMatchObject(denied);
      await expect(
        saveImportMapping(person, {
          importId,
          mapping: {},
          decimalSeparator: ".",
        }),
      ).rejects.toMatchObject(denied);
    }
    const warehouse = await member(actor.organizationId, "warehouse");
    expect((await getImport(warehouse, importId))!.id).toBe(importId);
  });
});
