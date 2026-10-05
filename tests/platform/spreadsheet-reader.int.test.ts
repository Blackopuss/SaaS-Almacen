import { readFileSync } from "node:fs";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildCsv, buildXlsx } from "@/platform/files";
import {
  READ_LIMITS,
  readCsv,
  readSpreadsheet,
  readXlsx,
} from "@/platform/files/spreadsheet-reader";

// IMP-04: reading what people upload. Text only: formulas are not
// evaluated, macros are never opened, sizes are bounded.

/** A ZIP built by hand, to make workbooks Excel would never write. */
function zip(
  files: Record<string, string | Buffer>,
  options: { lie?: Record<string, number>; flags?: number } = {},
): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const packed = deflateRawSync(data);
    const size = options.lie?.[name] ?? data.length;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(options.flags ?? 0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(options.flags ?? 0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const size = directory.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** A workbook with one sheet made of the given XML rows. */
function workbook(
  sheetData: string,
  extra: Record<string, string | Buffer> = {},
  sheets = '<sheet name="Hoja1" sheetId="1" r:id="rId1"/>',
) {
  return zip({
    "xl/workbook.xml": `<workbook ${NS} xmlns:r="r"><sheets>${sheets}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet ${NS}><sheetData>${sheetData}</sheetData></worksheet>`,
    ...extra,
  });
}

const rowsOf = (result: ReturnType<typeof readXlsx>) => {
  if (!result.ok) throw new Error(`not read: ${result.error}`);
  return result.rows;
};

describe("readCsv", () => {
  it("reads what the writer writes", () => {
    const rows = [
      ["Clave (SKU)", "Nombre", "Unidad"],
      ["TOR-001", 'Tornillo 1/4" × 1, galvanizado', "pieza"],
      ["CAB-012", "Cable ñ", "metro"],
    ];
    expect(readCsv(buildCsv(rows))).toEqual({
      ok: true,
      sheet: null,
      rows,
      formulaCells: 0,
      csv: { delimiter: ",", encoding: "UTF-8" },
    });
  });

  it("works out semicolons, tabs and the encoding older Excel saves", () => {
    const semicolons = readCsv(
      Buffer.from("Clave;Nombre;Existencia\r\nTOR-1;Tornillo;2,75\r\n"),
    );
    expect(semicolons).toMatchObject({
      ok: true,
      // The decimal comma stays as typed: the separator is chosen later.
      rows: [
        ["Clave", "Nombre", "Existencia"],
        ["TOR-1", "Tornillo", "2,75"],
      ],
      csv: { delimiter: ";", encoding: "UTF-8" },
    });
    expect(readCsv(Buffer.from("a\tb\n1\t2\n"))).toMatchObject({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      csv: { delimiter: "\t" },
    });
    // «Año;Piñón» saved as Windows-1252.
    const latin = Buffer.from([
      0x41, 0xf1, 0x6f, 0x3b, 0x50, 0x69, 0xf1, 0xf3, 0x6e, 0x0a,
    ]);
    expect(readCsv(latin)).toMatchObject({
      rows: [["Año", "Piñón"]],
      csv: { delimiter: ";", encoding: "Windows-1252" },
    });
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("Clave\tNombre\nT-1\tÑu\n", "utf16le"),
    ]);
    expect(readCsv(utf16)).toMatchObject({
      rows: [
        ["Clave", "Nombre"],
        ["T-1", "Ñu"],
      ],
      csv: { encoding: "UTF-16" },
    });
  });

  it("handles quotes, line breaks inside cells and ragged rows", () => {
    const result = readCsv(
      Buffer.from(
        'a,b,c\n"uno, dos","dijo ""hola""","línea\nsiguiente"\n\n  x  ,,\nsolo\n\n\n',
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      rows: [
        ["a", "b", "c"],
        ["uno, dos", 'dijo "hola"', "línea siguiente"],
        // The empty line keeps its place: row numbers match the file.
        [],
        ["x"],
        ["solo"],
      ],
    });
  });

  it("keeps formulas as the text they are", () => {
    const result = readCsv(
      Buffer.from("Clave,Nombre\n=1+1,\"=cmd|' /C calc'!A0\"\n"),
    );
    expect(result).toMatchObject({
      ok: true,
      rows: [
        ["Clave", "Nombre"],
        ["=1+1", "=cmd|' /C calc'!A0"],
      ],
      formulaCells: 0,
    });
  });

  it("refuses what is not a CSV, and bounds what it reads", () => {
    expect(readCsv(Buffer.alloc(0))).toMatchObject({
      ok: false,
      reason: "empty",
    });
    expect(readCsv(Buffer.from("\n\n  \n"))).toMatchObject({
      ok: false,
      reason: "empty",
    });
    expect(
      readCsv(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])),
    ).toMatchObject({ ok: false, reason: "format" });
    expect(
      readCsv(Buffer.from("x\n".repeat(READ_LIMITS.rows + 1))),
    ).toMatchObject({ ok: false, reason: "too_large" });
    expect(
      readCsv(Buffer.from(`${"a,".repeat(READ_LIMITS.columns + 1)}\n`)),
    ).toMatchObject({ ok: false, reason: "too_large" });
    const long = readCsv(Buffer.from(`a\n${"x".repeat(5_000)}\n`));
    expect(long.ok && long.rows[1]![0]!.length).toBe(READ_LIMITS.cell);
  });
});

describe("readXlsx", () => {
  it("reads what the writer writes", () => {
    const rows = [
      ["Clave (SKU)", "Nombre"],
      ["TOR-001", 'Tornillo <galv> & "ñ"'],
      ["", "solo la segunda"],
    ];
    const result = readXlsx(
      buildXlsx([
        { name: "Instrucciones", rows: [["no es esta"]] },
        { name: "Productos", rows, headerRows: 1 },
      ]),
    );
    // The sheet of the template wins over the first one.
    expect(result).toEqual({
      ok: true,
      sheet: "Productos",
      rows,
      formulaCells: 0,
    });
  });

  it("reads a workbook saved by Excel itself", () => {
    const file = readFileSync(
      path.join(process.cwd(), "tests/fixtures/excel-real.xlsx"),
    );
    const result = readXlsx(file);
    expect(result).toMatchObject({ ok: true, sheet: "Productos" });
    const rows = rowsOf(result);
    expect(rows[0]).toEqual([
      "Clave (SKU)",
      "Nombre",
      "Unidad",
      "Presentación",
      "Contenido de la presentación",
      "Existencia inicial",
      "Código de barras",
      "Mínimo",
    ]);
    expect(rows[1]).toEqual([
      "TOR-001",
      'Tornillo 1/4" × 1 <galv> & ñ',
      "pieza",
      "Caja",
      "100",
      "3",
      // A long number is not turned into 7.50123E+12.
      "7501234567890",
      // A formula (=E2*2): its stored value, not a computation.
      "200",
    ]);
    expect(rows[2]).toEqual([
      "CAB-012",
      "Cable THW calibre 12",
      "metro",
      "",
      "",
      "250.5",
      "",
      // Stored by Excel as 0.10000000000000001.
      "0.1",
    ]);
    expect(rows[3]).toEqual([]);
    expect(rows[4]!.slice(0, 6)).toEqual([
      "00123",
      "Clave con ceros",
      "pieza",
      "",
      "",
      "1234567.125",
    ]);
    expect(rows).toHaveLength(5);
    if (result.ok) expect(result.formulaCells).toBe(1);
  });

  it("takes shared strings, rich text, booleans and gaps", () => {
    const result = readXlsx(
      workbook(
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
          '<row r="3"><c r="B3" t="b"><v>1</v></c><c r="C3" t="e"><v>#N/A</v></c><c r="D3"><v>1.5E+3</v></c><c r="E3" t="s"><v>2</v></c></row>',
        {
          "xl/sharedStrings.xml": `<sst ${NS}><si><t>Clave</t></si><si><r><rPr><b/></rPr><t>Nom</t></r><r><t xml:space="preserve">bre </t></r><rPh><t>ignorado</t></rPh></si><si><t>a &amp; b &#241; _x000D_</t></si></sst>`,
        },
      ),
    );
    expect(rowsOf(result)).toEqual([
      ["Clave", "", "Nombre"],
      [],
      ["", "sí", "", "1500", "a & b ñ"],
    ]);
  });

  it("never evaluates formulas: it takes the stored value and counts them", () => {
    const result = readXlsx(
      workbook(
        '<row r="1"><c r="A1"><f>1+1</f><v>2</v></c>' +
          '<c r="B1" t="str"><f>HYPERLINK("http://malo.example","clic")</f><v>clic</v></c>' +
          // A formula nobody calculated yet has no value: it reads as empty.
          '<c r="C1"><f>WEBSERVICE("http://malo.example")</f></c>' +
          '<c r="D1" t="str"><f>cmd|\'/C calc\'!A0</f><v></v></c><c r="E1" t="inlineStr"><is><t>=2+2</t></is></c></row>',
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      rows: [["2", "clic", "", "", "=2+2"]],
      formulaCells: 4,
    });
  });

  it("does not open macros, links or anything beyond the sheets", () => {
    // Parts that are never unpacked may be anything, even a bomb.
    const result = readXlsx(
      workbook(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>dato</t></is></c></row>',
        {
          "xl/vbaProject.bin": Buffer.alloc(1_000_000, 7),
          "xl/externalLinks/externalLink1.xml":
            "<!DOCTYPE x [<!ENTITY a 'b'>]><x/>",
          "xl/media/image1.png": Buffer.alloc(10),
        },
      ),
    );
    expect(rowsOf(result)).toEqual([["dato"]]);
  });

  it("refuses XML that declares entities", () => {
    const bomb =
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>';
    expect(
      readXlsx(
        zip({
          "xl/workbook.xml": `<workbook ${NS} xmlns:r="r"><sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>`,
          "xl/_rels/workbook.xml.rels":
            '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
          "xl/worksheets/sheet1.xml": `${bomb}<worksheet ${NS}><sheetData><row><c t="inlineStr"><is><t>&lol2;</t></is></c></row></sheetData></worksheet>`,
        }),
      ),
    ).toMatchObject({ ok: false, reason: "format" });
    // An entity nobody declared is left as the text it is.
    expect(
      rowsOf(
        readXlsx(
          workbook(
            '<row><c t="inlineStr"><is><t>&lol; &amp; listo</t></is></c></row>',
          ),
        ),
      ),
    ).toEqual([["&lol; & listo"]]);
  });

  it("is not fooled by a file that unpacks to more than it says", () => {
    const sheet = `<worksheet ${NS}><sheetData>${'<row><c t="inlineStr"><is><t>x</t></is></c></row>'.repeat(2_000)}</sheetData></worksheet>`;
    const lying = zip(
      {
        "xl/workbook.xml": `<workbook ${NS} xmlns:r="r"><sheets><sheet name="H" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels":
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": sheet,
      },
      { lie: { "xl/worksheets/sheet1.xml": 100 } },
    );
    expect(readXlsx(lying)).toMatchObject({ ok: false, reason: "format" });
    const huge = zip(
      {
        "xl/workbook.xml": "<workbook/>",
        "xl/worksheets/sheet1.xml": "x",
      },
      { lie: { "xl/worksheets/sheet1.xml": READ_LIMITS.unpacked + 1 } },
    );
    expect(readXlsx(huge)).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("explains protected, old and broken files", () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(100),
    ]);
    expect(readXlsx(ole)).toMatchObject({ ok: false, reason: "protected" });
    expect(
      readXlsx(zip({ "xl/workbook.xml": "<workbook/>" }, { flags: 1 })),
    ).toMatchObject({ ok: false, reason: "protected" });
    expect(
      readXlsx(Buffer.from("esto no es un excel, de verdad que no")),
    ).toMatchObject({ ok: false, reason: "format" });
    expect(readXlsx(Buffer.alloc(5))).toMatchObject({
      ok: false,
      reason: "format",
    });
    // A ZIP that is not a workbook.
    expect(readXlsx(zip({ "hola.txt": "hola" }))).toMatchObject({
      ok: false,
      reason: "format",
    });
    // Cut in half.
    const good = buildXlsx([{ name: "Hoja", rows: [["a"]] }]);
    expect(readXlsx(good.subarray(0, good.length - 40))).toMatchObject({
      ok: false,
      reason: "format",
    });
    expect(readXlsx(workbook(""))).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });

  it("skips hidden sheets and bounds rows and columns", () => {
    const hidden = readXlsx(
      workbook(
        '<row><c t="inlineStr"><is><t>oculta</t></is></c></row>',
        {
          "xl/worksheets/sheet2.xml": `<worksheet ${NS}><sheetData><row><c t="inlineStr"><is><t>visible</t></is></c></row></sheetData></worksheet>`,
        },
        '<sheet name="Listas" sheetId="1" state="hidden" r:id="rId1"/><sheet name="Datos" sheetId="2" r:id="rId2"/>',
      ),
    );
    expect(hidden).toMatchObject({
      ok: true,
      sheet: "Datos",
      rows: [["visible"]],
    });
    expect(
      readXlsx(
        workbook(`<row r="${READ_LIMITS.rows + 1}"><c><v>1</v></c></row>`),
      ),
    ).toMatchObject({ ok: false, reason: "too_large" });
    expect(
      readXlsx(workbook('<row r="1"><c r="ZZ1"><v>1</v></c></row>')),
    ).toMatchObject({ ok: false, reason: "too_large" });
    // Formatting left far to the right, without content, is not an error.
    expect(
      rowsOf(
        readXlsx(
          workbook('<row r="1"><c r="A1"><v>1</v></c><c r="ZZ1" s="3"/></row>'),
        ),
      ),
    ).toEqual([["1"]]);
  });
});

describe("readSpreadsheet", () => {
  it("reads by the kind the name says", () => {
    const rows = [["a", "b"]];
    expect(readSpreadsheet("lista.CSV", buildCsv(rows))).toMatchObject({
      ok: true,
      rows,
    });
    expect(
      readSpreadsheet("lista.xlsx", buildXlsx([{ name: "H", rows }])),
    ).toMatchObject({ ok: true, rows });
    expect(readSpreadsheet("lista.xls", Buffer.from("x"))).toMatchObject({
      ok: false,
      reason: "format",
    });
    // A CSV that calls itself a workbook is not read as one.
    expect(readSpreadsheet("lista.xlsx", buildCsv(rows))).toMatchObject({
      ok: false,
      reason: "format",
    });
  });
});
