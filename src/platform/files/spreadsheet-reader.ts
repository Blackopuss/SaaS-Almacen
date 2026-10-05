import "server-only";

import { inflateRawSync } from "node:zlib";

/**
 * Reading spreadsheets people upload (IMP-04): CSV and XLSX, as plain
 * text cells. Nothing in a file is ever run: a formula is not evaluated
 * (the value Excel left stored next to it is taken), macros and links to
 * other files are never opened, and XML that declares entities is
 * refused. Sizes are bounded before and while unpacking, so a small file
 * cannot turn into a huge one.
 */

export const READ_LIMITS = {
  /** Rows read, titles included. */
  rows: 20_001,
  columns: 60,
  /** Characters kept of one cell. */
  cell: 2_000,
  /** Bytes an XLSX may unpack to, all parts together. */
  unpacked: 80 * 1024 * 1024,
  entries: 2_000,
} as const;

export type SpreadsheetContent = {
  /** Name of the sheet that was read; null for CSV. */
  sheet: string | null;
  /** Every row from the first one; cells are trimmed text ("" = empty). */
  rows: string[][];
  /** Cells that held a formula: their stored value was taken as is. */
  formulaCells: number;
  /** How the CSV was read, to tell the person. */
  csv?: { delimiter: "," | ";" | "\t" | "|"; encoding: string };
};

export type ReadSpreadsheetResult =
  | ({ ok: true } & SpreadsheetContent)
  | {
      ok: false;
      reason: "format" | "too_large" | "empty" | "protected";
      error: string;
    };

type Failure = Extract<ReadSpreadsheetResult, { ok: false }>;

class Unreadable extends Error {
  constructor(readonly failure: Failure) {
    super(failure.error);
  }
}

const fail = (reason: Failure["reason"], error: string): never => {
  throw new Unreadable({ ok: false, reason, error });
};

const TOO_MANY_ROWS = `El archivo tiene más de ${(READ_LIMITS.rows - 1).toLocaleString("es-MX")} filas. Divídelo en varios archivos.`;
const TOO_MANY_COLUMNS = `El archivo tiene más de ${READ_LIMITS.columns} columnas. Deja solo las de la plantilla.`;
const NOT_XLSX =
  "No pudimos leer el archivo como Excel (.xlsx). Ábrelo en Excel y guárdalo de nuevo como «Libro de Excel (.xlsx)».";

/** Text of a cell: no control characters, trimmed, bounded. */
function clean(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?|\n/g, " ")
    .trim()
    .slice(0, READ_LIMITS.cell);
}

/** Drops empty rows at the end and empty cells at the end of each row. */
function tidy(rows: string[][]): string[][] {
  const trimmed = rows.map((row) => {
    let end = row.length;
    while (end > 0 && (row[end - 1] ?? "") === "") end--;
    return Array.from({ length: end }, (_, i) => row[i] ?? "");
  });
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.length === 0) {
    trimmed.pop();
  }
  return trimmed;
}

// ── CSV ─────────────────────────────────────────────────────────────────

function decode(bytes: Uint8Array): { text: string; encoding: string } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.toString("utf8", 3), encoding: "UTF-8" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.toString("utf16le", 2), encoding: "UTF-16" };
  }
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      encoding: "UTF-8",
    };
  } catch {
    // What older Excel versions save on Windows in Spanish.
    return {
      text: new TextDecoder("windows-1252").decode(buffer),
      encoding: "Windows-1252",
    };
  }
}

const DELIMITERS = [",", ";", "\t", "|"] as const;

/** The separator that splits the first line into the most columns. */
function detectDelimiter(text: string): (typeof DELIMITERS)[number] {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  let seen = false;
  for (let i = 0; i < text.length && i < 100_000; i++) {
    const char = text[i]!;
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (seen) break;
    } else if (!quoted && counts.has(char)) {
      counts.set(char, counts.get(char)! + 1);
      seen = true;
    } else if (char.trim() !== "") seen = true;
  }
  let best: (typeof DELIMITERS)[number] = ",";
  for (const delimiter of DELIMITERS) {
    if (counts.get(delimiter)! > counts.get(best)!) best = delimiter;
  }
  return best;
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    if (row.length >= READ_LIMITS.columns) fail("too_large", TOO_MANY_COLUMNS);
    row.push(clean(cell));
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (rows.length >= READ_LIMITS.rows) fail("too_large", TOO_MANY_ROWS);
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (char === delimiter) endCell();
    else if (char === "\n") endRow();
    else if (char === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/** Reads a CSV file; the separator and the encoding are worked out. */
export function readCsv(bytes: Uint8Array): ReadSpreadsheetResult {
  try {
    if (bytes.byteLength === 0) fail("empty", "El archivo está vacío.");
    if (bytes.includes(0) && !(bytes[0] === 0xff && bytes[1] === 0xfe)) {
      fail(
        "format",
        "El archivo no parece texto CSV. Si es de Excel, súbelo como .xlsx.",
      );
    }
    const { text, encoding } = decode(bytes);
    const delimiter = detectDelimiter(text);
    const rows = tidy(parseCsv(text, delimiter));
    if (rows.length === 0) fail("empty", "El archivo no tiene filas.");
    return {
      ok: true,
      sheet: null,
      rows,
      formulaCells: 0,
      csv: { delimiter, encoding },
    };
  } catch (error) {
    if (error instanceof Unreadable) return error.failure;
    throw error;
  }
}

// ── XLSX ────────────────────────────────────────────────────────────────

/** Unpacks the parts of a ZIP file asked for, within the size limits. */
function unzip(
  file: Buffer,
  wanted: (path: string) => boolean,
): Map<string, Buffer> {
  // Old .xls and password-protected workbooks are OLE files, not ZIP.
  if (file.readUInt32BE(0) === 0xd0cf11e0) {
    fail(
      "protected",
      "El archivo está protegido con contraseña o es un .xls antiguo. Guárdalo sin contraseña como «Libro de Excel (.xlsx)».",
    );
  }
  if (file.readUInt32LE(0) !== 0x04034b50) fail("format", NOT_XLSX);
  const end = file.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > file.length) fail("format", NOT_XLSX);
  const count = file.readUInt16LE(end + 10);
  let at = file.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) {
    fail("too_large", "El archivo es demasiado grande para importarlo.");
  }
  if (count > READ_LIMITS.entries) fail("format", NOT_XLSX);

  const parts = new Map<string, Buffer>();
  let unpacked = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > file.length || file.readUInt32LE(at) !== 0x02014b50) {
      fail("format", NOT_XLSX);
    }
    const flags = file.readUInt16LE(at + 8);
    const method = file.readUInt16LE(at + 10);
    const packedSize = file.readUInt32LE(at + 20);
    const size = file.readUInt32LE(at + 24);
    const nameLength = file.readUInt16LE(at + 28);
    const extraLength = file.readUInt16LE(at + 30);
    const commentLength = file.readUInt16LE(at + 32);
    const local = file.readUInt32LE(at + 42);
    const path = file.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (!wanted(path)) continue;

    if (flags & 0x1) {
      fail(
        "protected",
        "El archivo está protegido con contraseña. Guárdalo sin contraseña.",
      );
    }
    unpacked += size;
    if (unpacked > READ_LIMITS.unpacked) {
      fail("too_large", "El archivo es demasiado grande para importarlo.");
    }
    if (local + 30 > file.length) fail("format", NOT_XLSX);
    const dataAt =
      local +
      30 +
      file.readUInt16LE(local + 26) +
      file.readUInt16LE(local + 28);
    const packed = file.subarray(dataAt, dataAt + packedSize);
    if (packed.length !== packedSize) fail("format", NOT_XLSX);
    let data: Buffer;
    if (method === 0) data = Buffer.from(packed);
    else if (method === 8) {
      try {
        // The declared size is the ceiling: more than that is a bomb.
        data = inflateRawSync(packed, { maxOutputLength: size + 1 });
      } catch {
        return fail("format", NOT_XLSX);
      }
    } else return fail("format", NOT_XLSX);
    if (data.length !== size) fail("format", NOT_XLSX);
    parts.set(path, data);
  }
  return parts;
}

/** Text of an XML part. Declared entities are never expanded: refused. */
function xmlText(part: Buffer | undefined): string {
  if (!part) return fail("format", NOT_XLSX);
  const text = part.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return fail("format", NOT_XLSX);
  return text;
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** The five entities of XML and numeric references; nothing else exists. */
function unescapeXml(text: string): string {
  return text
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(
      /&(#x[0-9A-Fa-f]{1,6}|#\d{1,7}|[a-z]+);/g,
      (whole, name: string) => {
        if (name.startsWith("#")) {
          const code =
            name[1] === "x"
              ? parseInt(name.slice(2), 16)
              : Number(name.slice(1));
          return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
        }
        return NAMED[name] ?? whole;
      },
    );
}

const attribute = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** All the text of a string item: its runs, without phonetic guides. */
function textOf(item: string): string {
  const visible = item.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const match of visible.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) {
    text += unescapeXml(match[1]!);
  }
  return text;
}

/** "B" → 1, "AA" → 26. */
function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference) {
    const code = char.charCodeAt(0);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index - 1;
}

/**
 * A number as a person would type it. Excel stores numbers in binary:
 * 0.1 may come as 0.10000000000000001 and large ones as 1E+21. This is
 * the shortest decimal text that is that same stored number — a change of
 * notation, not arithmetic.
 */
function numberText(stored: string): string {
  const text = stored.trim();
  if (/^-?\d{1,15}$/.test(text)) return text;
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  const short = String(value);
  return /e/i.test(short)
    ? value.toLocaleString("en-US", {
        useGrouping: false,
        maximumFractionDigits: 20,
      })
    : short;
}

function readSheet(
  xml: string,
  shared: string[],
): { rows: string[][]; formulaCells: number } {
  const rows: string[][] = [];
  let formulaCells = 0;
  let next = 0;
  for (const rowMatch of xml.matchAll(
    /<row(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/row>)/g,
  )) {
    const declared = Number(attribute(rowMatch[1] ?? "", "r"));
    const index = declared >= 1 ? declared - 1 : next;
    next = index + 1;
    if (index >= READ_LIMITS.rows) fail("too_large", TOO_MANY_ROWS);
    const row: string[] = [];
    let column = 0;
    for (const cell of (rowMatch[2] ?? "").matchAll(
      /<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const tag = cell[1] ?? "";
      const body = cell[2] ?? "";
      const reference = attribute(tag, "r");
      const at = reference ? columnIndex(reference) : column;
      column = at + 1;
      if (at < 0) continue;
      if (at >= READ_LIMITS.columns) {
        // Stray content far to the right is ignored unless it is text.
        if (/<v>|<is>/.test(body)) fail("too_large", TOO_MANY_COLUMNS);
        continue;
      }
      if (/<f[\s>/]/.test(body)) formulaCells++;
      const type = attribute(tag, "t") ?? "n";
      const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      let text = "";
      if (type === "s") text = shared[Number(value)] ?? "";
      else if (type === "inlineStr") text = textOf(body);
      else if (type === "str") text = unescapeXml(value);
      else if (type === "b") text = value === "1" ? "sí" : "no";
      // An error value (#N/A, #DIV/0!) is not data.
      else if (type === "e") text = "";
      else text = value === "" ? "" : numberText(unescapeXml(value));
      while (row.length < at) row.push("");
      row[at] = clean(text);
    }
    while (rows.length < index) rows.push([]);
    rows[index] = row;
  }
  return { rows, formulaCells };
}

/**
 * Reads the first sheet of a workbook — or the one called «Productos»,
 * the name of the template — as text.
 */
export function readXlsx(bytes: Uint8Array): ReadSpreadsheetResult {
  try {
    if (bytes.byteLength < 30) fail("format", NOT_XLSX);
    const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Only the workbook, its strings and its sheets are ever unpacked:
    // macros, images, links and anything else stay closed.
    const parts = unzip(
      file,
      (path) =>
        path === "xl/workbook.xml" ||
        path === "xl/_rels/workbook.xml.rels" ||
        path === "xl/sharedStrings.xml" ||
        /^xl\/worksheets\/[^/]+\.xml$/.test(path),
    );
    const workbook = xmlText(parts.get("xl/workbook.xml"));
    const relations = new Map<string, string>();
    for (const match of xmlText(
      parts.get("xl/_rels/workbook.xml.rels"),
    ).matchAll(/<Relationship\s[^>]*>/g)) {
      const id = attribute(match[0], "Id");
      const target = attribute(match[0], "Target");
      if (id && target) {
        relations.set(
          id,
          target.startsWith("/") ? target.slice(1) : `xl/${target}`,
        );
      }
    }
    const sheets = [...workbook.matchAll(/<sheet\s[^>]*>/g)].flatMap(
      (match) => {
        const name = attribute(match[0], "name");
        const id = attribute(match[0], "r:id");
        const path = id ? relations.get(id) : undefined;
        // Hidden sheets hold lists and helpers, not what the person filled in.
        const hidden = attribute(match[0], "state");
        return name && path && !hidden
          ? [{ name: unescapeXml(name), path }]
          : [];
      },
    );
    const chosen =
      sheets.find((sheet) => sheet.name.trim().toLowerCase() === "productos") ??
      sheets[0];
    if (!chosen) return fail("format", NOT_XLSX);

    const sharedPart = parts.get("xl/sharedStrings.xml");
    const shared = sharedPart
      ? [...xmlText(sharedPart).matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map(
          (match) => textOf(match[1] ?? ""),
        )
      : [];
    const sheet = readSheet(xmlText(parts.get(chosen.path)), shared);
    const rows = tidy(sheet.rows);
    if (rows.length === 0) {
      fail("empty", `La hoja «${chosen.name}» no tiene filas.`);
    }
    return {
      ok: true,
      sheet: chosen.name,
      rows,
      formulaCells: sheet.formulaCells,
    };
  } catch (error) {
    if (error instanceof Unreadable) return error.failure;
    // A broken file must never take the server down with it.
    if (error instanceof RangeError) {
      return { ok: false, reason: "format", error: NOT_XLSX };
    }
    throw error;
  }
}

/** Reads a spreadsheet by the kind its name says it is. */
export function readSpreadsheet(
  name: string,
  bytes: Uint8Array,
): ReadSpreadsheetResult {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return readCsv(bytes);
  if (extension === "xlsx") return readXlsx(bytes);
  return {
    ok: false,
    reason: "format",
    error: "Solo se pueden leer archivos .csv o .xlsx.",
  };
}
