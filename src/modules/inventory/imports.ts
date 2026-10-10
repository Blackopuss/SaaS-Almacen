import "server-only";

import { newId } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import {
  deleteFile,
  readSpreadsheet,
  readStoredFile,
  storeFile,
} from "@/platform/files";
import { forOrganization } from "@/server";

import { IMPORT_COLUMNS, type ImportColumnKey } from "./import-template";
import type { InventoryActor } from "./movements";

/**
 * Import of products from a spreadsheet: reading and mapping (IMP-04).
 * The file is kept as a private file of the company and read as text —
 * nothing in it is run. Then the person says which of its columns is
 * each of ours and how its decimals are written; that is never guessed.
 * Nothing of the catalog changes here.
 */

export type DecimalSeparator = "." | ",";

export const IMPORT_STATUS_LABELS = {
  MAPPING: "Falta elegir columnas",
  READY: "Columnas listas",
  CONFIRMED: "Confirmada, en espera",
  RUNNING: "Importando…",
  DONE: "Importada",
  FAILED: "No se pudo terminar",
  CANCELLED: "Cancelada",
} as const;

export type ImportStatus = keyof typeof IMPORT_STATUS_LABELS;

/** While the person is still deciding how to read the file. */
export const isImportEditable = (status: ImportStatus) =>
  status === "MAPPING" || status === "READY";

/** Our columns whose content is a number. */
export const NUMERIC_IMPORT_COLUMNS = [
  "presentationContent",
  "initialStock",
  "minimum",
] as const satisfies readonly ImportColumnKey[];

/**
 * A number of the file as the system writes numbers ("1234.5"), read
 * with the separator the person chose. Thousands separators are accepted
 * only where they belong (groups of three); anything doubtful is refused
 * rather than guessed: «1,5» with decimal point is not 1.5 nor 15.
 */
export function normalizeDecimal(
  text: string,
  separator: DecimalSeparator,
): { ok: true; value: string } | { ok: false; error: string } {
  const raw = text.trim().replace(/ |\s/g, "");
  const thousands = separator === "." ? "," : ".";
  const escape = (char: string) => (char === "." ? "\\." : char);
  const shape = new RegExp(
    `^[+-]?(\\d+|\\d{1,3}(${escape(thousands)}\\d{3})+)(${escape(separator)}\\d+)?$`,
  );
  if (!shape.test(raw)) {
    const example = separator === "." ? "1234.5" : "1234,5";
    return {
      ok: false,
      error:
        raw === ""
          ? "Falta el número."
          : `«${text.trim()}» no se entiende como número con ${separator === "." ? "punto" : "coma"} decimal. Escríbelo como ${example}.`,
    };
  }
  const value = raw
    .split(thousands)
    .join("")
    .replace(separator, ".")
    .replace(/^\+/, "");
  return { ok: true, value };
}

/** Title without accents, case, punctuation or extra spaces. */
function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Other names people give our columns in their own files. */
const SYNONYMS: Record<ImportColumnKey, string[]> = {
  sku: [
    "clave",
    "sku",
    "codigo",
    "codigo interno",
    "clave sku",
    "clave producto",
  ],
  name: [
    "nombre",
    "producto",
    "articulo",
    "descripcion corta",
    "nombre del producto",
  ],
  description: ["descripcion", "detalle", "descripcion larga"],
  category: ["categoria", "linea", "familia", "departamento"],
  brand: ["marca", "fabricante"],
  barcode: ["codigo de barras", "codigo barras", "ean", "upc", "barras"],
  unit: ["unidad", "unidad de medida", "um", "medida"],
  presentation: ["presentacion", "empaque"],
  presentationContent: [
    "contenido de la presentacion",
    "contenido",
    "piezas por caja",
    "factor",
  ],
  initialStock: [
    "existencia inicial",
    "existencia",
    "existencias",
    "stock",
    "cantidad",
    "saldo",
  ],
  initialStockIn: ["existencia contada en", "contada en", "existencia en"],
  location: ["ubicacion", "estante", "anaquel", "localizacion"],
  minimum: ["minimo", "stock minimo", "existencia minima", "punto de reorden"],
};

export type ImportMapping = Partial<Record<ImportColumnKey, number>>;

/**
 * First guess of which column of the file is each of ours, by its title.
 * The template's own titles always match; the person confirms or changes
 * every one before anything is read with it.
 */
export function suggestMapping(headers: readonly string[]): ImportMapping {
  const titles = headers.map(normalizeTitle);
  const taken = new Set<number>();
  const mapping: ImportMapping = {};
  // Exact names of the template first, then the other usual names.
  for (const exactOnly of [true, false]) {
    for (const column of IMPORT_COLUMNS) {
      if (mapping[column.key] !== undefined) continue;
      const names = exactOnly
        ? [normalizeTitle(column.header)]
        : SYNONYMS[column.key];
      const index = titles.findIndex(
        (title, i) => !taken.has(i) && title !== "" && names.includes(title),
      );
      if (index >= 0) {
        mapping[column.key] = index;
        taken.add(index);
      }
    }
  }
  return mapping;
}

/** Titles and data of what was read: the first row with text is the titles. */
function shape(rows: string[][]) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell !== ""));
  if (headerIndex < 0) return null;
  const headers = rows[headerIndex]!;
  const data = rows
    .slice(headerIndex + 1)
    .map((cells, offset) => ({ row: headerIndex + 2 + offset, cells }))
    .filter(({ cells }) => cells.some((cell) => cell !== ""));
  return { headerRow: headerIndex + 1, headers, data };
}

export type StartImportResult =
  | { ok: true; importId: string }
  | { ok: false; reason: "file" | "content"; error: string };

/**
 * Starts an import from an uploaded file: keeps it, reads it and proposes
 * the column map. A file that cannot be read is not kept.
 */
export async function startImport(
  actor: InventoryActor,
  input: { name: string; bytes: Uint8Array },
): Promise<StartImportResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.import.create",
  );
  const stored = await storeFile(actor, {
    purpose: "import_source",
    name: input.name,
    bytes: input.bytes,
  });
  if (!stored.ok) return { ok: false, reason: "file", error: stored.error };

  const refuse = async (error: string): Promise<StartImportResult> => {
    await deleteFile(actor, stored.fileId);
    return { ok: false, reason: "content", error };
  };
  const content = readSpreadsheet(input.name, input.bytes);
  if (!content.ok) return refuse(content.error);
  const table = shape(content.rows);
  if (!table || table.data.length === 0) {
    return refuse(
      "El archivo solo tiene títulos o está vacío. Agrega al menos un producto debajo de los títulos.",
    );
  }
  const titled = table.headers.filter((title) => title !== "");
  if (titled.length < 2) {
    return refuse(
      "No encontramos los títulos de las columnas en la primera fila con texto. Usa la plantilla o pon un título a cada columna.",
    );
  }
  if (new Set(titled.map(normalizeTitle)).size !== titled.length) {
    return refuse(
      "Hay columnas con el mismo título. Cambia el título de una para poder distinguirlas.",
    );
  }

  const importId = newId();
  await forOrganization(organizationId).productImport.create({
    data: {
      id: importId,
      organizationId,
      fileId: stored.fileId,
      sheetName: content.sheet?.slice(0, 64) ?? null,
      headerRow: table.headerRow,
      headers: table.headers,
      dataRows: table.data.length,
      formulaCells: content.formulaCells,
      mapping: suggestMapping(table.headers),
      createdByUserId: userId,
    },
  });
  return { ok: true, importId };
}

export type ImportDetail = {
  id: string;
  status: ImportStatus;
  fileName: string;
  /** Sheet that was read; null for CSV. */
  sheetName: string | null;
  headerRow: number;
  /** Titles of the file, by column; "" where a column has none. */
  headers: string[];
  dataRows: number;
  formulaCells: number;
  mapping: ImportMapping;
  decimalSeparator: DecimalSeparator | null;
  /** Places of the plan held since it was confirmed (IMP-07). */
  reservedPlaces: number;
  confirmedAt: Date | null;
  /** Products fixed at confirmation, and how many the worker finished. */
  totalItems: number;
  processedItems: number;
  failedItems: number;
  finishedAt: Date | null;
  lastError: string | null;
  /** First rows of data, as text, to recognize the columns. */
  preview: { row: number; cells: string[] }[];
  /**
   * Once the separator is chosen: how the numbers of the first rows are
   * read with it, so a wrong choice is seen before going on.
   */
  numbers: {
    column: ImportColumnKey;
    header: string;
    samples: { row: number; text: string; value: string | null }[];
  }[];
  createdAt: Date;
};

const PREVIEW_ROWS = 5;

function asMapping(value: unknown, columns: number): ImportMapping {
  const mapping: ImportMapping = {};
  if (!value || typeof value !== "object") return mapping;
  for (const column of IMPORT_COLUMNS) {
    const index = (value as Record<string, unknown>)[column.key];
    if (
      Number.isInteger(index) &&
      (index as number) >= 0 &&
      (index as number) < columns
    ) {
      mapping[column.key] = index as number;
    }
  }
  return mapping;
}

/** An import of the company with a preview of its file; null if not found. */
export async function getImport(
  actor: InventoryActor,
  importId: string,
): Promise<ImportDetail | null> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "inventory.import.read");
  const row = await forOrganization(organizationId).productImport.findFirst({
    where: { id: String(importId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      fileId: true,
      sheetName: true,
      headerRow: true,
      headers: true,
      dataRows: true,
      formulaCells: true,
      mapping: true,
      decimalSeparator: true,
      reservedPlaces: true,
      confirmedAt: true,
      totalItems: true,
      processedItems: true,
      failedItems: true,
      finishedAt: true,
      lastError: true,
      createdAt: true,
      file: { select: { name: true } },
    },
  });
  if (!row) return null;
  const headers = Array.isArray(row.headers) ? row.headers.map(String) : [];
  const mapping = asMapping(row.mapping, headers.length);
  const decimalSeparator =
    row.decimalSeparator === "." || row.decimalSeparator === ","
      ? row.decimalSeparator
      : null;

  const file = await readStoredFile(organizationId, row.fileId);
  const content = file ? readSpreadsheet(file.name, file.bytes) : null;
  const table = content?.ok ? shape(content.rows) : null;
  const preview = (table?.data ?? []).slice(0, PREVIEW_ROWS).map((line) => ({
    row: line.row,
    cells: headers.map((_, i) => line.cells[i] ?? ""),
  }));

  const numbers = decimalSeparator
    ? NUMERIC_IMPORT_COLUMNS.flatMap((key) => {
        const index = mapping[key];
        if (index === undefined) return [];
        const samples = preview
          .filter((line) => line.cells[index] !== "")
          .map((line) => {
            const text = line.cells[index]!;
            const read = normalizeDecimal(text, decimalSeparator);
            return { row: line.row, text, value: read.ok ? read.value : null };
          });
        return [
          {
            column: key,
            header: IMPORT_COLUMNS.find((column) => column.key === key)!.header,
            samples,
          },
        ];
      })
    : [];

  return {
    id: row.id,
    status: row.status,
    fileName: row.file.name,
    sheetName: row.sheetName,
    headerRow: row.headerRow,
    headers,
    dataRows: row.dataRows,
    formulaCells: row.formulaCells,
    mapping,
    decimalSeparator,
    reservedPlaces: row.reservedPlaces,
    confirmedAt: row.confirmedAt,
    totalItems: row.totalItems,
    processedItems: row.processedItems,
    failedItems: row.failedItems,
    finishedAt: row.finishedAt,
    lastError: row.lastError,
    preview,
    numbers,
    createdAt: row.createdAt,
  };
}

export type SaveMappingResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "not_found";
      /** Problem of a column of ours, or of "decimalSeparator". */
      fieldErrors: Partial<
        Record<ImportColumnKey | "decimalSeparator", string>
      >;
      formError?: string;
    };

/**
 * Saves which column of the file is each of ours and how decimals are
 * written. Both are the person's answer: required columns must be
 * matched, a column of the file feeds one of ours at most, and the
 * decimal separator has no default.
 */
export async function saveImportMapping(
  actor: InventoryActor,
  input: {
    importId: string;
    /** Our column → column of the file (from 0); missing or "" = not in the file. */
    mapping: Record<string, unknown>;
    decimalSeparator: unknown;
  },
): Promise<SaveMappingResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.import.create",
  );
  const client = forOrganization(organizationId);
  const row = await client.productImport.findFirst({
    where: { id: String(input.importId).slice(0, 36) },
    select: { id: true, headers: true, status: true },
  });
  if (!row) {
    return {
      ok: false,
      reason: "not_found",
      fieldErrors: {},
      formError: "Esta importación ya no existe.",
    };
  }
  if (!isImportEditable(row.status)) {
    return {
      ok: false,
      reason: "invalid",
      fieldErrors: {},
      formError:
        "Esta importación ya se confirmó: sus columnas ya no se pueden cambiar.",
    };
  }
  const columns = Array.isArray(row.headers) ? row.headers.length : 0;
  const fieldErrors: Extract<SaveMappingResult, { ok: false }>["fieldErrors"] =
    {};
  const mapping: ImportMapping = {};
  const usedBy = new Map<number, string>();
  for (const column of IMPORT_COLUMNS) {
    const given = input.mapping?.[column.key];
    const text =
      given === undefined || given === null ? "" : String(given).trim();
    if (text === "") {
      if (column.required) {
        fieldErrors[column.key] =
          `Elige qué columna de tu archivo es «${column.header}»: es obligatoria.`;
      }
      continue;
    }
    const index = /^\d{1,3}$/.test(text) ? Number(text) : -1;
    if (index < 0 || index >= columns) {
      fieldErrors[column.key] = "Esa columna no está en tu archivo.";
      continue;
    }
    const other = usedBy.get(index);
    if (other) {
      fieldErrors[column.key] =
        `Esa columna ya la elegiste para «${other}». Cada columna de tu archivo se usa una vez.`;
      continue;
    }
    usedBy.set(index, column.header);
    mapping[column.key] = index;
  }
  // A presentation without its content (or the other way round) says nothing.
  if (
    (mapping.presentation === undefined) !==
    (mapping.presentationContent === undefined)
  ) {
    const missing =
      mapping.presentation === undefined
        ? "presentation"
        : "presentationContent";
    fieldErrors[missing] ??=
      "La presentación y su contenido van juntos: elige las dos columnas o ninguna.";
  }
  const decimalSeparator =
    input.decimalSeparator === "." || input.decimalSeparator === ","
      ? input.decimalSeparator
      : null;
  if (!decimalSeparator) {
    fieldErrors.decimalSeparator =
      "Dinos cómo vienen escritos los decimales en tu archivo.";
  }
  if (Object.keys(fieldErrors).length > 0 || !decimalSeparator) {
    return { ok: false, reason: "invalid", fieldErrors };
  }
  const saved = await client.productImport.updateMany({
    // Confirmed meanwhile: its columns stay as they were confirmed.
    where: { id: row.id, status: { in: ["MAPPING", "READY"] } },
    data: { mapping, decimalSeparator, status: "READY" },
  });
  if (saved.count !== 1) {
    return {
      ok: false,
      reason: "invalid",
      fieldErrors: {},
      formError:
        "Esta importación ya se confirmó: sus columnas ya no se pueden cambiar.",
    };
  }
  return { ok: true };
}

export type ImportSummary = {
  id: string;
  fileName: string;
  status: ImportStatus;
  dataRows: number;
  createdAt: Date;
};

/** Latest imports of the company, newest first. */
export async function listImports(
  actor: InventoryActor,
): Promise<ImportSummary[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.import.read",
  );
  const rows = await forOrganization(
    actor.organizationId,
  ).productImport.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 10,
    select: {
      id: true,
      status: true,
      dataRows: true,
      createdAt: true,
      file: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    fileName: row.file.name,
    status: row.status,
    dataRows: row.dataRows,
    createdAt: row.createdAt,
  }));
}

/** Products of an import the worker could not apply, with the reason. */
export async function listImportFailures(
  actor: InventoryActor,
  importId: string,
): Promise<{ sku: string; row: number | null; error: string }[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.import.read",
  );
  const items = await forOrganization(
    actor.organizationId,
  ).productImportItem.findMany({
    where: { importId: String(importId).slice(0, 36), status: "FAILED" },
    orderBy: { position: "asc" },
    take: 200,
    select: { sku: true, error: true, data: true },
  });
  return items.map((item) => {
    const row = (item.data as { row?: unknown } | null)?.row;
    return {
      sku: item.sku,
      row: typeof row === "number" ? row : null,
      error: item.error ?? "No se pudo aplicar.",
    };
  });
}
