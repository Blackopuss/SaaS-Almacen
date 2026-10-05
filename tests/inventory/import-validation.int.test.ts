import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  IMPORT_COLUMNS,
  buildImportTemplate,
  saveImportMapping,
  startImport,
  validateImport,
  validateImportRows,
  type ImportColumnKey,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-05: validation cell by cell and preview. Errors by row and column,
// without changing any data.

const KEYS = IMPORT_COLUMNS.map((column) => column.key);
const HEADERS = IMPORT_COLUMNS.map((column) => column.header);
const MAPPING = Object.fromEntries(KEYS.map((key, index) => [key, index]));
const LOCATIONS = [
  { id: "general", path: "General", isDefault: true },
  { id: "a3", path: "Zona A › Estante 3", isDefault: false },
  { id: "b1", path: "Zona B › Estante 1", isDefault: false },
];

type Row = Partial<Record<ImportColumnKey, string>>;
const cells = (row: Row) => KEYS.map((key) => row[key] ?? "");

/** Validates rows given by column name; the first one is row 2 of a file. */
function check(rows: Row[], decimalSeparator: "." | "," = ".") {
  return validateImportRows(
    rows.map((row, index) => ({ row: index + 2, cells: cells(row) })),
    {
      headers: HEADERS,
      mapping: MAPPING,
      decimalSeparator,
      locations: LOCATIONS,
    },
  );
}

/** Problems of one row as «column: message». */
const problems = (rows: Row[], separator: "." | "," = ".") =>
  check(rows, separator).issues.map(
    (issue) => `${issue.row} ${issue.column}: ${issue.message}`,
  );

const base: Row = { sku: "TOR-1", name: "Tornillo", unit: "pieza" };

describe("validateImportRows", () => {
  it("understands a full row as the template shows it", () => {
    const result = check([
      {
        sku: "TOR-001",
        name: "Tornillo hexagonal",
        description: "Galvanizado",
        category: "Tornillería",
        brand: "Fiero",
        barcode: "7501234567890",
        unit: "Pieza",
        presentation: "Caja",
        presentationContent: "100",
        initialStock: "3",
        initialStockIn: "caja",
        location: "zona a > estante 3",
        minimum: "200",
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.valid).toEqual([
      {
        row: 2,
        sku: "TOR-001",
        name: "Tornillo hexagonal",
        description: "Galvanizado",
        category: "Tornillería",
        brand: "Fiero",
        barcode: "7501234567890",
        unitCode: "piece",
        presentation: { name: "Caja", content: "100" },
        stock: {
          base: "300",
          captured: "3",
          inPresentation: true,
          locationId: "a3",
          locationPath: "Zona A › Estante 3",
        },
        minimum: "200",
      },
    ]);
  });

  it("the minimum a row needs: key, name and unit", () => {
    expect(check([base])).toMatchObject({
      issues: [],
      invalidRows: 0,
      valid: [
        {
          sku: "TOR-1",
          unitCode: "piece",
          presentation: null,
          stock: null,
          minimum: null,
        },
      ],
    });
    expect(problems([{}])).toEqual([
      "2 sku: Falta la clave del producto.",
      "2 name: Falta el nombre.",
      "2 unit: Falta la unidad: pieza, metro, kilogramo…",
    ]);
    expect(problems([{ ...base, name: "T" }])).toEqual([
      "2 name: El nombre necesita al menos 2 letras.",
    ]);
  });

  it("says in which row and column each problem is, with the person's title", () => {
    const result = validateImportRows(
      [
        { row: 5, cells: ["TOR-1", "Tornillo", "pieza", "3.5"] },
        { row: 9, cells: ["", "Clavo", "caja", ""] },
      ],
      {
        headers: ["Código", "Artículo", "UM", "Existencia"],
        mapping: { sku: 0, name: 1, unit: 2, initialStock: 3 },
        decimalSeparator: ".",
        locations: LOCATIONS,
      },
    );
    expect(result.invalidRows).toBe(2);
    expect(result.valid).toEqual([]);
    expect(
      result.issues.map((i) => [i.row, i.column, i.header, i.value]),
    ).toEqual([
      [5, "initialStock", "Existencia", "3.5"],
      [9, "sku", "Código", ""],
      [9, "unit", "UM", "caja"],
    ]);
    expect(result.issues[0]!.message).toContain("no admite fracciones");
    expect(result.issues[2]!.message).toContain("no es una unidad");
    expect(result.issues[2]!.message).toContain("Presentación");
  });

  it("recognizes units by name, plural, symbol or accent", () => {
    for (const [text, code] of [
      ["pieza", "piece"],
      ["PIEZAS", "piece"],
      ["pza", "piece"],
      ["Metro", "m"],
      ["metros", "m"],
      ["kilogramo", "kg"],
      ["kg", "kg"],
      ["litro", "l"],
      ["Centimetro", "cm"],
    ]) {
      const result = check([{ ...base, unit: text! }]);
      expect(result.issues, text).toEqual([]);
      expect(result.valid[0]!.unitCode, text).toBe(code);
    }
    for (const text of ["caja", "rollo", "bulto", "pz."]) {
      expect(check([{ ...base, unit: text }]).invalidRows, text).toBe(1);
    }
  });

  it("reads numbers with the chosen separator and the rule of the unit", () => {
    const cable: Row = { sku: "CAB-1", name: "Cable", unit: "metro" };
    expect(
      check([{ ...cable, initialStock: "1.234,5", minimum: "2,75" }], ",")
        .valid[0],
    ).toMatchObject({ stock: { base: "1234.5" }, minimum: "2.75" });
    expect(
      check([{ ...cable, initialStock: "1,234.5" }], ".").valid[0],
    ).toMatchObject({ stock: { base: "1234.5", locationId: "general" } });
    // The other separator is not guessed.
    expect(problems([{ ...cable, initialStock: "2,75" }], ".")).toEqual([
      "2 initialStock: «2,75» no se entiende como número con punto decimal. Escríbelo como 1234.5.",
    ]);
    expect(problems([{ ...cable, initialStock: "2.755" }])[0]).toContain(
      "pasos de 0.01",
    );
    expect(problems([{ ...base, initialStock: "-5" }])).toEqual([
      "2 initialStock: No puede ser negativo.",
    ]);
    expect(problems([{ ...base, initialStock: "diez" }])[0]).toContain(
      "no se entiende como número",
    );
    expect(problems([{ ...base, minimum: "0.5" }])[0]).toContain(
      "no admite fracciones",
    );
    // Zero is «none»: no initial balance, no minimum.
    expect(
      check([{ ...base, initialStock: "0", minimum: "0" }]).valid[0],
    ).toMatchObject({ stock: null, minimum: null });
  });

  it("presentation and content go together and convert the stock", () => {
    expect(problems([{ ...base, presentation: "Caja" }])).toEqual([
      "2 presentationContent: Falta cuánto trae «Caja». Sin contenido no se puede convertir.",
    ]);
    expect(problems([{ ...base, presentationContent: "100" }])).toEqual([
      "2 presentation: Hay contenido pero falta el nombre de la presentación (caja, rollo, saco…).",
    ]);
    expect(
      problems([{ ...base, presentation: "Caja", presentationContent: "0" }]),
    ).toEqual(["2 presentationContent: El contenido debe ser mayor que cero."]);
    expect(
      problems([
        { ...base, presentation: "Caja", presentationContent: "12.5" },
      ])[0],
    ).toContain("no admite fracciones");
    expect(
      problems([
        { ...base, presentation: "Piezas", presentationContent: "10" },
      ])[0],
    ).toContain("es la unidad del producto");

    const boxed: Row = {
      ...base,
      presentation: "Caja",
      presentationContent: "100",
    };
    // Counted in the unit unless the row says it is in its presentation.
    expect(
      check([{ ...boxed, initialStock: "30" }]).valid[0]!.stock,
    ).toMatchObject({ base: "30", inPresentation: false });
    expect(
      check([{ ...boxed, initialStock: "30", initialStockIn: "piezas" }])
        .valid[0]!.stock,
    ).toMatchObject({ base: "30", inPresentation: false });
    expect(
      check([{ ...boxed, initialStock: "3", initialStockIn: "CAJA" }]).valid[0]!
        .stock,
    ).toMatchObject({ base: "300", captured: "3", inPresentation: true });
    expect(
      problems([{ ...boxed, initialStock: "2.5", initialStockIn: "Caja" }])[0],
    ).toContain("se cuentan completas");
    expect(
      problems([{ ...boxed, initialStock: "3", initialStockIn: "Bolsa" }])[0],
    ).toContain("No coincide con la presentación de la fila");
    expect(
      problems([{ ...base, initialStock: "3", initialStockIn: "Caja" }])[0],
    ).toContain("no tiene presentación");
    // A saco of 50 kg, 12 sacos: 600 kg.
    expect(
      check([
        {
          sku: "CEM",
          name: "Cemento",
          unit: "kilogramo",
          presentation: "Saco",
          presentationContent: "50",
          initialStock: "12",
          initialStockIn: "Saco",
        },
      ]).valid[0]!.stock,
    ).toMatchObject({ base: "600" });
  });

  it("locations must exist; empty is General", () => {
    const stocked: Row = { ...base, initialStock: "5" };
    expect(check([stocked]).valid[0]!.stock).toMatchObject({
      locationId: "general",
      locationPath: "General",
    });
    for (const text of [
      "General",
      "Zona B › Estante 1",
      "zona b/estante 1",
      " ZONA B > ESTANTE 1 ",
    ]) {
      expect(check([{ ...stocked, location: text }]).issues, text).toEqual([]);
    }
    expect(problems([{ ...stocked, location: "Bodega 9" }])).toEqual([
      "2 location: No existe la ubicación «Bodega 9». Créala en Ubicaciones o corrige la ruta (por ejemplo «Zona A › Estante 3»).",
    ]);
    // A location without stock to put there is not looked at.
    expect(check([{ ...base, location: "Bodega 9" }]).issues).toEqual([]);
  });

  it("a key repeats only to give the stock of another location", () => {
    const here: Row = { ...base, initialStock: "5" };
    const there: Row = { ...here, location: "Zona A › Estante 3" };
    expect(check([here, there])).toMatchObject({ issues: [], invalidRows: 0 });
    expect(
      check([here, there]).valid.map((row) => row.stock!.locationId),
    ).toEqual(["general", "a3"]);
    expect(problems([here, here])[0]).toContain(
      "ya está en la fila 2 con la misma ubicación",
    );
    expect(problems([base, { ...base }])[0]).toContain(
      "solo se repite para dar la existencia de otra ubicación",
    );
    expect(problems([here, { ...there, name: "Otro nombre" }])[0]).toContain(
      "con otro nombre o unidad",
    );
    // Keys are the same whatever their case.
    expect(problems([here, { ...here, sku: "tor-1" }])).toHaveLength(1);
  });

  it("a barcode belongs to one product of the file", () => {
    const a: Row = { ...base, barcode: "750100" };
    expect(
      problems([
        a,
        { sku: "CLA-2", name: "Clavo", unit: "pieza", barcode: "750100" },
      ]),
    ).toEqual([
      "3 barcode: Ese código de barras ya lo tiene otro producto en la fila 2.",
    ]);
    // The same product in another location repeats its own barcode.
    expect(
      check([
        { ...a, initialStock: "1" },
        { ...a, initialStock: "1", location: "Zona A › Estante 3" },
      ]).issues,
    ).toEqual([]);
  });

  it("bounds text and reports every problem of a row", () => {
    const result = check([
      {
        sku: "X".repeat(65),
        name: "N".repeat(161),
        category: "C".repeat(81),
        barcode: "B".repeat(65),
        unit: "pieza",
      },
      base,
    ]);
    expect(result.issues.map((issue) => issue.column)).toEqual([
      "sku",
      "name",
      "category",
      "barcode",
    ]);
    // One bad row does not stop the good ones.
    expect(result).toMatchObject({ invalidRows: 1 });
    expect(result.valid.map((row) => row.row)).toEqual([3]);
  });
});

describe("validateImport", () => {
  const stamp = Date.now();
  let counter = 0;
  let actor: InventoryActor;
  let shelf = "";

  async function newUser() {
    const user = await db.user.create({
      data: {
        id: newId(),
        name: "Persona",
        email: `validar.${++counter}.${stamp}@example.test`,
        emailVerified: true,
      },
    });
    return user.id;
  }

  async function member(role: Role) {
    const userId = await newUser();
    const membership = await db.membership.create({
      data: { id: newId(), organizationId: actor.organizationId, userId },
    });
    await db.membershipRole.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        membershipId: membership.id,
        role,
      },
    });
    return { organizationId: actor.organizationId, userId };
  }

  /** An import of the given rows with the template's columns, mapped. */
  async function mapped(rows: Row[], separator: "." | "," = ".") {
    const started = await startImport(actor, {
      name: "productos.csv",
      bytes: buildCsv([HEADERS, ...rows.map(cells)], { neutralize: false }),
    });
    if (!started.ok) throw new Error(started.error);
    const saved = await saveImportMapping(actor, {
      importId: started.importId,
      mapping: MAPPING,
      decimalSeparator: separator,
    });
    if (!saved.ok) throw new Error("mapping not saved");
    return started.importId;
  }

  beforeAll(async () => {
    const owner = await newUser();
    const created = await createOrganization(owner, {
      name: "Ferretería",
      timeZone: "",
    });
    if (!created.ok) throw new Error("company setup failed");
    const staff = await newUser();
    await db.platformStaff.create({ data: { userId: staff } });
    const result = await provisionCompany(
      moduleRegistry,
      staff,
      created.organizationId,
      {
        productLimit: 50,
        users: 10,
        modules: ["inventory"],
        validUntil: null,
        reason: "Prueba de validación",
      },
    );
    if (!result.ok) throw new Error("provision failed");
    actor = { organizationId: created.organizationId, userId: owner };
    const location = await createLocation(actor, {
      kind: "SHELF",
      name: "Estante 3",
    });
    if (!location.ok) throw new Error("location setup failed");
    shelf = location.locationId;
  }, 60_000);

  afterEach(() => invalidateEntitlements());
  afterAll(() => db.$disconnect());

  it("the template's own examples are valid as they come", async () => {
    const template = await buildImportTemplate(actor, "csv");
    const started = await startImport(actor, {
      name: template.name,
      bytes: template.bytes,
    });
    if (!started.ok) throw new Error(started.error);
    await saveImportMapping(actor, {
      importId: started.importId,
      mapping: MAPPING,
      decimalSeparator: ".",
    });
    const result = await validateImport(actor, started.importId);
    expect(result).toMatchObject({
      ok: true,
      totalRows: 4,
      validRows: 4,
      invalidRows: 0,
      products: 4,
      issueCount: 0,
      issues: [],
    });
    if (!result.ok) return;
    expect(result.preview[0]).toEqual({
      row: 2,
      sku: "TOR-001",
      name: "Tornillo hexagonal 1/4 × 1",
      unit: "pieza",
      presentation: "Caja de 100 piezas",
      stock: "3 cajas × 100 = 300 piezas en General",
      minimum: "200 piezas",
    });
    expect(result.preview[1]).toMatchObject({
      unit: "metro",
      presentation: "Rollo de 100 metros",
      stock: "250.5 metros en General",
      minimum: "50 metros",
    });
    expect(result.preview[2]!.stock).toBe(
      "12 sacos × 50 = 600 kilogramos en General",
    );
    expect(result.preview[3]).toMatchObject({
      presentation: null,
      stock: "8 piezas en General",
      minimum: null,
    });
  });

  it("reports errors by row and column, and counts rows", async () => {
    const importId = await mapped([
      { sku: "TOR-1", name: "Tornillo", unit: "pieza", initialStock: "10" },
      { sku: "CAB-2", name: "Cable", unit: "rollo" },
      {
        sku: "TOR-1",
        name: "Tornillo",
        unit: "pieza",
        initialStock: "4",
        location: "Estante 3",
      },
      { sku: "", name: "Sin clave", unit: "pieza", initialStock: "1.5" },
      { sku: "LIJ-3", name: "Lija", unit: "pieza", location: "No existe" },
    ]);
    const result = await validateImport(actor, importId);
    expect(result).toMatchObject({
      ok: true,
      totalRows: 5,
      validRows: 3,
      invalidRows: 2,
      // TOR-1 in two locations is one product.
      products: 2,
      issueCount: 3,
    });
    if (!result.ok) return;
    expect(
      result.issues.map((issue) => [issue.row, issue.column, issue.header]),
    ).toEqual([
      [3, "unit", "Unidad"],
      [5, "sku", "Clave (SKU)"],
      [5, "initialStock", "Existencia inicial"],
    ]);
    expect(result.preview.map((row) => [row.row, row.stock])).toEqual([
      [2, "10 piezas en General"],
      [4, "4 piezas en Estante 3"],
      [6, null],
    ]);
    expect(shelf).toBeTruthy();
  });

  it("changes nothing: not the catalog, the stock nor the import", async () => {
    const importId = await mapped([
      { sku: "TOR-9", name: "Tornillo", unit: "pieza", initialStock: "10" },
    ]);
    const before = await db.productImport.findUniqueOrThrow({
      where: { id: importId },
    });
    const counts = async () => [
      await db.product.count({
        where: { organizationId: actor.organizationId },
      }),
      await db.stockMovement.count({
        where: { organizationId: actor.organizationId },
      }),
      await db.stockBalance.count({
        where: { organizationId: actor.organizationId },
      }),
      await db.productPresentation.count({
        where: { organizationId: actor.organizationId },
      }),
    ];
    const start = await counts();
    const first = await validateImport(actor, importId);
    const second = await validateImport(actor, importId);
    expect(second).toEqual(first);
    expect(await counts()).toEqual(start);
    expect(
      await db.productImport.findUniqueOrThrow({ where: { id: importId } }),
    ).toEqual(before);
  });

  it("needs the columns and the separator first", async () => {
    const started = await startImport(actor, {
      name: "sin-mapa.csv",
      bytes: buildCsv([
        HEADERS,
        cells({ sku: "A", name: "Ab", unit: "pieza" }),
      ]),
    });
    if (!started.ok) throw new Error(started.error);
    expect(await validateImport(actor, started.importId)).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    expect(await validateImport(actor, newId())).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("uses the locations of its own company and is closed to others", async () => {
    const importId = await mapped([
      {
        sku: "TOR-7",
        name: "Tornillo",
        unit: "pieza",
        initialStock: "1",
        location: "Estante 3",
      },
    ]);
    expect(await validateImport(actor, importId)).toMatchObject({
      ok: true,
      validRows: 1,
    });
    const owner = await newUser();
    const other = await createOrganization(owner, {
      name: "Otra",
      timeZone: "",
    });
    if (!other.ok) throw new Error("company setup failed");
    const staff = await db.platformStaff.findFirstOrThrow();
    await provisionCompany(moduleRegistry, staff.userId, other.organizationId, {
      productLimit: 50,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de validación",
    });
    expect(
      await validateImport(
        { organizationId: other.organizationId, userId: owner },
        importId,
      ),
    ).toMatchObject({ ok: false, reason: "not_found" });
    await expect(
      validateImport(await member("viewer"), importId),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect((await validateImport(await member("warehouse"), importId)).ok).toBe(
      true,
    );
  });
});
