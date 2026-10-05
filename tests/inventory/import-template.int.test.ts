import { inflateRawSync } from "node:zlib";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  IMPORT_COLUMNS,
  buildImportTemplate,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { UNITS } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv, buildXlsx, neutralizeFormula } from "@/platform/files";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-03: downloadable template (CSV and XLSX) with examples of unit and
// presentation; and the writer of spreadsheets it uses.

/** Entries of a ZIP file, read from its central directory. */
function unzip(file: Buffer): Record<string, string> {
  const end = file.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  const entries: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(file.readUInt32LE(at)).toBe(0x02014b50);
    const packedSize = file.readUInt32LE(at + 20);
    const size = file.readUInt32LE(at + 24);
    const nameLength = file.readUInt16LE(at + 28);
    const local = file.readUInt32LE(at + 42);
    const name = file.toString("utf8", at + 46, at + 46 + nameLength);
    const dataAt =
      local +
      30 +
      file.readUInt16LE(local + 26) +
      file.readUInt16LE(local + 28);
    const data = inflateRawSync(file.subarray(dataAt, dataAt + packedSize));
    expect(data.length).toBe(size);
    entries[name] = data.toString("utf8");
    at += 46 + nameLength;
  }
  return entries;
}

/** Text of every cell of a sheet, by row. */
function cells(sheetXml: string): string[][] {
  return [...sheetXml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(([, row]) =>
    [...row!.matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map(([, text]) =>
      text!
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&"),
    ),
  );
}

describe("spreadsheet writer", () => {
  it("writes CSV that Excel reads: BOM, quotes and CRLF", () => {
    const csv = buildCsv([
      ["Clave", "Nombre", "Nota"],
      ["TOR-1", 'Tornillo 1/4" × 1, galvanizado', "dos\nlíneas"],
      ["", null, undefined],
      [" con espacios ", 12, "ñ"],
    ]).toString("utf8");
    expect(csv).toBe(
      "﻿Clave,Nombre,Nota\r\n" +
        'TOR-1,"Tornillo 1/4"" × 1, galvanizado","dos\nlíneas"\r\n' +
        ",,\r\n" +
        '" con espacios ",12,ñ\r\n',
    );
  });

  it("never lets a cell become a formula", () => {
    for (const text of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tx", "\rx"]) {
      expect(neutralizeFormula(text)).toBe(`'${text}`);
    }
    for (const text of ["TOR-1", "2.75", "a=b", "", "ñ"]) {
      expect(neutralizeFormula(text)).toBe(text);
    }
    expect(buildCsv([["=HYPERLINK(1)"]]).toString("utf8")).toContain(
      "'=HYPERLINK(1)",
    );
    const sheet = unzip(buildXlsx([{ name: "Hoja", rows: [["=1+1"]] }]))[
      "xl/worksheets/sheet1.xml"
    ]!;
    expect(cells(sheet)).toEqual([["'=1+1"]]);
    // No formula element exists anywhere in what is written.
    expect(sheet).not.toMatch(/<f[ >]/);
  });

  it("writes a workbook with its parts and text cells", () => {
    const parts = unzip(
      buildXlsx([
        {
          name: "Productos",
          headerRows: 1,
          widths: [12, 40],
          rows: [
            ["Clave", "Nombre"],
            ["TOR-1", 'Tornillo <galv> & "ñ"'],
            ["", "solo la segunda"],
          ],
        },
        { name: "Instrucciones", rows: [["Hola"]] },
      ]),
    );
    expect(Object.keys(parts).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="Productos"');
    expect(parts["xl/workbook.xml"]).toContain('<sheet name="Instrucciones"');
    const first = parts["xl/worksheets/sheet1.xml"]!;
    expect(cells(first)).toEqual([
      ["Clave", "Nombre"],
      ["TOR-1", 'Tornillo <galv> & "ñ"'],
      ["solo la segunda"],
    ]);
    // Titles in bold and frozen; the lone cell keeps its column.
    expect(first).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(first).toContain('state="frozen"');
    expect(first).toContain('<c r="B3" t="inlineStr">');
    // Nothing that could run or reach outside.
    const all = Object.values(parts).join("");
    expect(all).not.toMatch(/vbaProject|externalLink|<f[ >]|DOCTYPE/i);
  });

  it("refuses workbooks it cannot write", () => {
    expect(() => buildXlsx([])).toThrow();
    expect(() =>
      buildXlsx([
        { name: "Hoja", rows: [] },
        { name: "hoja", rows: [] },
      ]),
    ).toThrow();
  });
});

describe("import template", () => {
  const stamp = Date.now();
  let counter = 0;
  let actor: InventoryActor;

  async function newUser() {
    const user = await db.user.create({
      data: {
        id: newId(),
        name: "Persona",
        email: `plantilla.${++counter}.${stamp}@example.test`,
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
        reason: "Prueba de plantilla",
      },
    );
    if (!result.ok) throw new Error("provision failed");
    actor = { organizationId: created.organizationId, userId: owner };
  }, 60_000);

  afterEach(() => invalidateEntitlements());
  afterAll(() => db.$disconnect());

  const headers = IMPORT_COLUMNS.map((column) => column.header);
  const column = (key: string) =>
    IMPORT_COLUMNS.findIndex((item) => item.key === key);

  it("in Excel: titles, examples of unit and presentation, and instructions", async () => {
    const template = await buildImportTemplate(actor, "xlsx");
    expect(template).toMatchObject({
      name: "plantilla-productos.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parts = unzip(template.bytes);
    const [titles, ...examples] = cells(parts["xl/worksheets/sheet1.xml"]!);
    expect(titles).toEqual(headers);
    expect(examples.length).toBeGreaterThanOrEqual(3);

    const full = examples[0]!;
    // A product by piece that comes in boxes of 100, counted in boxes.
    expect(full[column("unit")]).toBe("pieza");
    expect(full[column("presentation")]).toBe("Caja");
    expect(full[column("presentationContent")]).toBe("100");
    expect(full[column("initialStock")]).toBe("3");
    expect(full[column("initialStockIn")]).toBe("Caja");

    const sheet = parts["xl/worksheets/sheet1.xml"]!;
    // Other units, with decimals, and a product without presentation.
    expect(sheet).toContain(">metro<");
    expect(sheet).toContain(">kilogramo<");
    expect(sheet).toContain(">250.5<");
    expect(sheet).toContain(">Martillo de uña 16 oz<");

    const instructions = cells(parts["xl/worksheets/sheet2.xml"]!);
    const text = instructions.flat();
    for (const item of IMPORT_COLUMNS) {
      expect(text).toContain(item.header);
      expect(text).toContain(item.help);
    }
    // Every unit of the catalog is listed, so the file can be filled in.
    for (const unit of UNITS) expect(text).toContain(unit.name);
    expect(text.join(" ")).toContain("Decimales con punto");
  });

  it("in CSV: the same titles and examples", async () => {
    const template = await buildImportTemplate(actor, "csv");
    expect(template).toMatchObject({
      name: "plantilla-productos.csv",
      contentType: "text/csv; charset=utf-8",
    });
    const lines = template.bytes.toString("utf8").split("\r\n");
    expect(lines[0]).toBe(`﻿${headers.join(",")}`);
    expect(lines[1]).toContain("TOR-001");
    expect(lines[1]).toContain("pieza,Caja,100,3,Caja");
    expect(lines.filter((line) => line !== "")).toHaveLength(5);
  });

  it("units of the examples exist in the catalog", async () => {
    const template = await buildImportTemplate(actor, "csv");
    const names = new Set<string>(UNITS.map((unit) => unit.name));
    const rows = template.bytes
      .toString("utf8")
      .split("\r\n")
      .slice(1)
      .filter(Boolean);
    for (const row of rows) {
      const unit = row.split(",").find((cell) => names.has(cell));
      expect(unit, row).toBeDefined();
    }
  });

  it("only who may import gets it", async () => {
    const denied = { code: "permission_denied" };
    for (const role of ["viewer", "buyer"] as const) {
      await expect(
        buildImportTemplate(await member(role), "xlsx"),
      ).rejects.toMatchObject(denied);
    }
    expect(
      (await buildImportTemplate(await member("warehouse"), "csv")).bytes
        .length,
    ).toBeGreaterThan(100);
  });
});
