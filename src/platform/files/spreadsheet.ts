import "server-only";

import { crc32, deflateRawSync } from "node:zlib";

/**
 * Writing spreadsheets (IMP-03): CSV and a minimal XLSX, enough for
 * templates and exports. Every cell is written as text — no formulas, no
 * macros, no external links can come out of here — and a cell that a
 * spreadsheet program would run as a formula is neutralized first.
 */

export type Cell = string | number | null | undefined;
export type Sheet = {
  /** Tab name: up to 31 characters, none of \ / ? * [ ] : */
  name: string;
  rows: Cell[][];
  /** Rows at the top shown in bold (titles). */
  headerRows?: number;
  /** Width of each column, in characters. */
  widths?: number[];
};

/**
 * Text that Excel or LibreOffice would treat as a formula when the file
 * is opened («=1+1», «+SUM(…)», «@cmd»). A leading apostrophe makes the
 * program show it as plain text (OWASP, CSV injection).
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const cellText = (cell: Cell): string =>
  cell === null || cell === undefined ? "" : String(cell);

/**
 * CSV as Excel opens it without questions: UTF-8 with BOM, comma, CRLF,
 * every field quoted when it needs to be.
 */
export function buildCsv(
  rows: Cell[][],
  options: { neutralize?: boolean } = {},
): Buffer {
  const neutralize = options.neutralize ?? true;
  const lines = rows.map((row) =>
    row
      .map((cell) => {
        const raw = cellText(cell);
        const text = neutralize ? neutralizeFormula(raw) : raw;
        return /[",\r\n]/.test(text) || /^\s|\s$/.test(text)
          ? `"${text.replace(/"/g, '""')}"`
          : text;
      })
      .join(","),
  );
  return Buffer.from(`﻿${lines.join("\r\n")}\r\n`, "utf8");
}

const xml = (text: string) =>
  text
    // Characters XML 1.0 cannot carry.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** A → 1 … Z → 26, AA → 27. */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function sheetXml(sheet: Sheet, neutralize: boolean): string {
  const header = sheet.headerRows ?? 0;
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map(
          (width, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(100, width))}" customWidth="1"/>`,
        )
        .join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const raw = cellText(cell);
          if (raw === "") return "";
          const text = neutralize ? neutralizeFormula(raw) : raw;
          const style = r < header ? ' s="1"' : "";
          // Inline text: what is written is what is shown, never computed.
          return `<c r="${columnName(c)}${r + 1}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const freeze =
    header > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header}" topLeftCell="A${header + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/** ZIP container with deflated entries: what an .xlsx file is. */
function zip(files: { path: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const packed = deflateRawSync(file.data);
    const sum = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names in UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

/** A workbook Excel, LibreOffice and Google Sheets open. Text cells only. */
export function buildXlsx(
  sheets: Sheet[],
  options: { neutralize?: boolean } = {},
): Buffer {
  if (sheets.length === 0) throw new Error("A workbook needs a sheet");
  const neutralize = options.neutralize ?? true;
  const names = sheets.map((sheet) =>
    sheet.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31),
  );
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
    throw new Error("Sheet names must be different");
  }
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  const file = (path: string, text: string) => ({
    path,
    data: Buffer.from(text, "utf8"),
  });
  return zip([
    file(
      "[Content_Types].xml",
      `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${type}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${type}.styles+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${type}.worksheet+xml"/>`,
        )
        .join("")}</Types>`,
    ),
    file(
      "_rels/.rels",
      `${head}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    file(
      "xl/workbook.xml",
      `${head}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>${names
        .map(
          (name, i) =>
            `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join("")}</sheets></workbook>`,
    ),
    file(
      "xl/_rels/workbook.xml.rels",
      `${head}<Relationships xmlns="${pkg}">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join(
          "",
        )}<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    ),
    file(
      "xl/styles.xml",
      // Style 0: normal. Style 1: bold, for titles.
      `${head}<styleSheet xmlns="${main}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
    ...sheets.map((sheet, i) =>
      file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet, neutralize)),
    ),
  ]);
}
