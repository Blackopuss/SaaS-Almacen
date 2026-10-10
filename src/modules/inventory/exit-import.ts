import "server-only";

import { dec, isAppError, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { getUnit, parseQuantity } from "@/platform/catalog";
import {
  buildCsv,
  buildXlsx,
  deleteFile,
  readSpreadsheet,
  readStoredFile,
  storeFile,
  type Cell,
} from "@/platform/files";
import { enqueueJob } from "@/platform/jobs";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { foldName, foldPath } from "./import-validation";
import { normalizeDecimal, type DecimalSeparator } from "./imports";
import {
  formatStock,
  listStockLocations,
  type InventoryActor,
} from "./movements";

/**
 * Import of daily exits (IMP-10): what the business sold or used, kept
 * in another system or on paper, arrives as a file and leaves stock.
 *
 * Every row names the sale it belongs to — its ticket or folio, the
 * «external identifier» — and that is what keeps stock honest: a sale of
 * a product is discounted once, whatever file brings it again. Uploading
 * yesterday's file twice, or a file that overlaps the previous one,
 * changes nothing the second time.
 *
 * Here: the template, reading and checking the file, confirming it and
 * knowing up to which day exits are imported. Registering the exits is
 * the work of the queue (`exit-import-apply.ts`).
 */

export const EXIT_IMPORT_JOB_TYPE = "inventory.import_exits";

export const EXIT_COLUMNS = [
  {
    key: "day",
    header: "Fecha",
    required: true,
    help: "El día en que salió, como 2026-10-09 o 09/10/2026 (día/mes/año).",
    example: "2026-10-09",
  },
  {
    key: "externalId",
    header: "Folio",
    required: true,
    help: "El número de ticket, nota o venta de donde sale la fila. Con él sabemos que una venta ya se descontó y no se descuenta dos veces.",
    example: "T-000123",
  },
  {
    key: "sku",
    header: "Clave (SKU)",
    required: false,
    help: "La clave del producto en tu catálogo. Puedes usar el código de barras en su lugar.",
    example: "TOR-001",
  },
  {
    key: "barcode",
    header: "Código de barras",
    required: false,
    help: "Si tu sistema de ventas solo da el código de barras, úsalo en vez de la clave.",
    example: "",
  },
  {
    key: "quantity",
    header: "Cantidad",
    required: true,
    help: "Cuánto salió, en la unidad del producto; o cuántas presentaciones, si llenas la columna «Presentación».",
    example: "25",
  },
  {
    key: "presentation",
    header: "Presentación",
    required: false,
    help: "Solo si la cantidad está contada en una presentación del producto (caja, rollo, saco).",
    example: "",
  },
  {
    key: "location",
    header: "Ubicación",
    required: false,
    help: "De dónde salió: «Zona A › Estante 3». Vacía = General.",
    example: "",
  },
] as const;

export type ExitColumnKey = (typeof EXIT_COLUMNS)[number]["key"];

const headerOf = (key: ExitColumnKey) =>
  EXIT_COLUMNS.find((column) => column.key === key)!.header;

/** Other titles people's sales systems give these columns. */
const SYNONYMS: Record<ExitColumnKey, string[]> = {
  day: ["fecha", "dia", "fecha de venta", "fecha venta"],
  externalId: [
    "folio",
    "ticket",
    "nota",
    "venta",
    "identificador",
    "id",
    "numero de ticket",
    "no ticket",
    "num ticket",
    "folio de venta",
  ],
  sku: ["clave sku", "clave", "sku", "codigo", "clave producto", "producto"],
  barcode: ["codigo de barras", "codigo barras", "ean", "upc", "barras"],
  quantity: ["cantidad", "piezas", "unidades", "vendido", "cant"],
  presentation: ["presentacion", "empaque"],
  location: ["ubicacion", "estante", "anaquel"],
};

/** Title without accents, case or punctuation. */
const foldTitle = (title: string) =>
  foldName(title)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type ExitMapping = Partial<Record<ExitColumnKey, number>>;

/**
 * Which column of the file is each of ours, by its title. Unlike the
 * import of products there is no step to choose them: a file of exits is
 * made every day, so its titles are the template's (or the usual ones).
 */
export function matchExitColumns(headers: readonly string[]): {
  mapping: ExitMapping;
  /** Titles that had to be there and were not found. */
  missing: string[];
} {
  const titles = headers.map(foldTitle);
  const taken = new Set<number>();
  const mapping: ExitMapping = {};
  for (const column of EXIT_COLUMNS) {
    const names = [foldTitle(column.header), ...SYNONYMS[column.key]];
    const index = titles.findIndex(
      (title, i) => !taken.has(i) && title !== "" && names.includes(title),
    );
    if (index >= 0) {
      mapping[column.key] = index;
      taken.add(index);
    }
  }
  const missing: string[] = EXIT_COLUMNS.filter(
    (column) => column.required && mapping[column.key] === undefined,
  ).map((column) => column.header);
  if (mapping.sku === undefined && mapping.barcode === undefined) {
    missing.push(`${headerOf("sku")} o ${headerOf("barcode")}`);
  }
  return { mapping, missing };
}

/** A day written as 2026-10-09, 09/10/2026 or 9-10-2026 (day first); null if it is not one. */
export function parseExitDay(text: string): string | null {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  const parts = iso
    ? [iso[1]!, iso[2]!, iso[3]!]
    : local
      ? [local[3]!, local[2]!, local[1]!]
      : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** «9 de octubre de 2026», from a day as 2026-10-09. */
export function formatExitDay(day: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00.000Z`));
}

const asDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const asDay = (date: Date) => date.toISOString().slice(0, 10);

/** Today in the calendar of the company. */
function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export type ExitIssue = {
  /** Row of the file, as the person sees it. */
  row: number;
  column: ExitColumnKey | null;
  header: string;
  value: string;
  message: string;
};

/** A product of the catalog, as the check needs it. */
export type ExitProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  status: "ACTIVE" | "ARCHIVED";
  unitCode: string;
  quantityStep: string;
  presentations: { id: string; name: string }[];
};

/** A row that passed, as it will be registered. */
export type ValidExitRow = {
  row: number;
  /** 2026-10-09. */
  day: string;
  externalId: string;
  productId: string;
  sku: string;
  productName: string;
  unitCode: string;
  presentation: { id: string; name: string } | null;
  /** As written, with decimal point. */
  quantity: string;
  locationId: string;
  locationPath: string;
};

export type ExitRowsValidation = {
  valid: ValidExitRow[];
  issues: ExitIssue[];
  invalidRows: number;
};

const hasControl = (text: string) => /[\u0000-\u001f\u007f]/.test(text);

/** What identifies a sale of a product in the company, whatever file brings it. */
export const exitKey = (productId: string, externalId: string) =>
  `${productId}:${foldName(externalId)}`;

/**
 * Checks the rows of a file of exits. Pure: the products, locations and
 * today's date of the company come as arguments.
 */
export function validateExitRows(
  rows: { row: number; cells: string[] }[],
  options: {
    headers: string[];
    mapping: ExitMapping;
    decimalSeparator: DecimalSeparator;
    /** Today in the calendar of the company: 2026-10-10. */
    today: string;
    products: ExitProduct[];
    locations: { id: string; path: string; isDefault: boolean }[];
  },
): ExitRowsValidation {
  const { headers, mapping } = options;
  const bySku = new Map(
    options.products.map((product) => [foldName(product.sku), product]),
  );
  const byBarcode = new Map(
    options.products.flatMap((product) =>
      product.barcode ? [[product.barcode, product] as const] : [],
    ),
  );
  const general = options.locations.find((location) => location.isDefault);
  const byPath = new Map(
    options.locations.map((location) => [foldPath(location.path), location]),
  );

  const issues: ExitIssue[] = [];
  const valid: ValidExitRow[] = [];
  let invalidRows = 0;
  /** First row of each sale of a product. */
  const seen = new Map<string, number>();

  for (const { row, cells } of rows) {
    const cell = (key: ExitColumnKey) => {
      const index = mapping[key];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    let failed = false;
    const issue = (column: ExitColumnKey, message: string) => {
      failed = true;
      const index = mapping[column];
      issues.push({
        row,
        column,
        header:
          (index !== undefined && headers[index]) || headerOf(column) || "",
        value: cell(column).slice(0, 80),
        message,
      });
    };

    const dayText = cell("day");
    const day = parseExitDay(dayText);
    if (dayText === "") {
      issue("day", "Falta la fecha en que salió.");
    } else if (!day) {
      issue(
        "day",
        /^\d{5}(\.\d+)?$/.test(dayText)
          ? "La fecha viene como número de Excel. Da a la columna formato de texto y escríbela como 2026-10-09 o 09/10/2026."
          : "No se entiende la fecha. Escríbela como 2026-10-09 o 09/10/2026 (día/mes/año).",
      );
    } else if (day > options.today) {
      issue("day", "La fecha es posterior a hoy: todavía no pudo salir.");
    }

    const externalId = cell("externalId");
    if (externalId === "") {
      issue(
        "externalId",
        "Falta el folio o ticket. Sin él no sabríamos si esta salida ya se descontó.",
      );
    } else if (externalId.length > 64 || hasControl(externalId)) {
      issue("externalId", "El folio admite hasta 64 caracteres, sin saltos.");
    }

    const sku = cell("sku");
    const barcode = cell("barcode");
    let product: ExitProduct | undefined;
    if (sku === "" && barcode === "") {
      issue(
        mapping.sku !== undefined ? "sku" : "barcode",
        "Escribe la clave o el código de barras del producto.",
      );
    } else {
      const fromSku = sku === "" ? undefined : bySku.get(foldName(sku));
      const fromBarcode = barcode === "" ? undefined : byBarcode.get(barcode);
      if (sku !== "" && !fromSku) {
        issue("sku", `No hay un producto con la clave «${sku.slice(0, 64)}».`);
      } else if (barcode !== "" && !fromBarcode) {
        issue("barcode", "No hay un producto con ese código de barras.");
      } else if (fromSku && fromBarcode && fromSku.id !== fromBarcode.id) {
        issue(
          "barcode",
          `Ese código de barras es de ${fromBarcode.sku}, no de ${fromSku.sku}. Deja solo uno de los dos.`,
        );
      } else {
        product = fromSku ?? fromBarcode;
        if (product && product.status !== "ACTIVE") {
          issue(
            sku !== "" ? "sku" : "barcode",
            `${product.sku} está archivado. Reactívalo para registrar sus salidas.`,
          );
          product = undefined;
        }
      }
    }

    const quantityText = cell("quantity");
    const presentationName = cell("presentation");
    let quantity: string | null = null;
    let presentation: ValidExitRow["presentation"] = null;
    if (quantityText === "") {
      issue("quantity", "Falta la cantidad que salió.");
    } else {
      const read = normalizeDecimal(quantityText, options.decimalSeparator);
      if (!read.ok) {
        issue("quantity", read.error);
      } else if (product) {
        if (presentationName !== "") {
          presentation =
            product.presentations.find(
              (item) => foldName(item.name) === foldName(presentationName),
            ) ?? null;
          if (!presentation) {
            issue(
              "presentation",
              `${product.sku} no tiene una presentación «${presentationName.slice(0, 60)}». Deja la columna vacía si la cantidad está en ${getUnit(product.unitCode).plural}.`,
            );
          } else if (
            !/^\d{1,9}$/.test(read.value) ||
            dec(read.value).isZero()
          ) {
            issue(
              "quantity",
              `Las presentaciones se cuentan completas: escribe cuántas «${presentation.name}» salieron, sin decimales.`,
            );
          } else {
            quantity = read.value;
          }
        } else {
          const parsed = parseQuantity(
            { unitCode: product.unitCode, quantityStep: product.quantityStep },
            read.value,
          );
          if (!parsed.ok) issue("quantity", parsed.error);
          else quantity = parsed.quantity.toString();
        }
      }
    }

    const locationText = cell("location");
    const location =
      locationText === "" || foldPath(locationText) === "general"
        ? general
        : byPath.get(foldPath(locationText));
    if (!location) {
      issue(
        "location",
        `No existe la ubicación «${locationText.slice(0, 80)}». Corrige la ruta (por ejemplo «Zona A › Estante 3») o déjala vacía para General.`,
      );
    }

    if (product && externalId !== "") {
      const key = exitKey(product.id, externalId);
      const first = seen.get(key);
      if (first !== undefined) {
        issue(
          "externalId",
          `El folio «${externalId.slice(0, 64)}» ya trae ${product.sku} en la fila ${first}. Suma las cantidades en una sola fila.`,
        );
      } else {
        seen.set(key, row);
      }
    }

    if (failed || !day || !product || !quantity || !location) {
      invalidRows++;
      continue;
    }
    valid.push({
      row,
      day,
      externalId,
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      unitCode: product.unitCode,
      presentation,
      quantity,
      locationId: location.id,
      locationPath: location.path,
    });
  }
  return { valid, issues, invalidRows };
}

export type ExitTemplate = { name: string; contentType: string; bytes: Buffer };

/** The template of a file of exits: titles, one example and how to fill it. */
export async function buildExitTemplate(
  actor: InventoryActor,
  format: "xlsx" | "csv",
): Promise<ExitTemplate> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.import.create",
  );
  const headers = EXIT_COLUMNS.map((column) => column.header);
  const examples: Cell[][] = [
    EXIT_COLUMNS.map((column) => column.example),
    ["2026-10-09", "T-000123", "CAB-012", "", "12.5", "", ""],
    [
      "2026-10-09",
      "T-000124",
      "TOR-001",
      "",
      "2",
      "Caja",
      "Zona A › Estante 3",
    ],
  ];
  if (format === "csv") {
    return {
      name: "plantilla-salidas.csv",
      contentType: "text/csv; charset=utf-8",
      bytes: buildCsv([headers, ...examples]),
    };
  }
  const instructions: Cell[][] = [
    ["Cómo llenar el archivo de salidas"],
    [
      "Cada fila de la hoja «Salidas» es un producto que salió en una venta. Borra las filas de ejemplo. No cambies los títulos de la primera fila.",
    ],
    [
      "El folio es lo que evita descontar dos veces: si subes de nuevo una venta que ya se importó, no vuelve a salir de tu inventario.",
    ],
    [
      "Un ticket con varios productos se escribe en una fila por producto, con el mismo folio.",
    ],
    [
      "Guarda todas las celdas como texto, también la fecha. Decimales con punto (2.75), sin separador de miles.",
    ],
    [""],
    ["Columna", "¿Obligatoria?", "Qué poner", "Ejemplo"],
    ...EXIT_COLUMNS.map((column): Cell[] => [
      column.header,
      column.required
        ? "Sí"
        : column.key === "sku" || column.key === "barcode"
          ? "Una de las dos"
          : "No",
      column.help,
      column.example,
    ]),
  ];
  return {
    name: "plantilla-salidas.xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: buildXlsx([
      { name: "Salidas", rows: [headers, ...examples] },
      { name: "Instrucciones", rows: instructions },
    ]),
  };
}

/** Titles and data of what was read: the first row with text is the titles. */
function shape(rows: string[][]) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell !== ""));
  if (headerIndex < 0) return null;
  const data = rows
    .slice(headerIndex + 1)
    .map((cells, offset) => ({ row: headerIndex + 2 + offset, cells }))
    .filter(({ cells }) => cells.some((cell) => cell !== ""));
  return { headers: rows[headerIndex]!, data };
}

export type StartExitImportResult =
  | { ok: true; importId: string }
  | {
      ok: false;
      reason: "separator" | "file" | "content";
      error: string;
    };

/**
 * Receives a file of exits: keeps it as a private file of the company,
 * reads it as text and finds its columns. A file that cannot be read, or
 * that lacks a column, is not kept. Nothing leaves stock here.
 */
export async function startExitImport(
  actor: InventoryActor,
  input: { name: string; bytes: Uint8Array; decimalSeparator: unknown },
): Promise<StartExitImportResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.import.create",
  );
  const separator = input.decimalSeparator;
  if (separator !== "." && separator !== ",") {
    return {
      ok: false,
      reason: "separator",
      error: "Dinos cómo vienen escritos los decimales en tu archivo.",
    };
  }
  const stored = await storeFile(actor, {
    purpose: "import_source",
    name: input.name,
    bytes: input.bytes,
  });
  if (!stored.ok) return { ok: false, reason: "file", error: stored.error };

  const refuse = async (error: string): Promise<StartExitImportResult> => {
    await deleteFile(actor, stored.fileId);
    return { ok: false, reason: "content", error };
  };
  const content = readSpreadsheet(input.name, input.bytes);
  if (!content.ok) return refuse(content.error);
  const table = shape(content.rows);
  if (!table || table.data.length === 0) {
    return refuse(
      "El archivo solo tiene títulos o está vacío. Agrega al menos una salida debajo de los títulos.",
    );
  }
  const { missing } = matchExitColumns(table.headers);
  if (missing.length > 0) {
    return refuse(
      `No encontramos ${missing.length === 1 ? "la columna" : "las columnas"} ${missing.map((title) => `«${title}»`).join(", ")} en la primera fila con texto. Usa los títulos de la plantilla.`,
    );
  }
  const importId = newId();
  await forOrganization(organizationId).exitImport.create({
    data: {
      id: importId,
      organizationId,
      fileId: stored.fileId,
      decimalSeparator: separator,
      dataRows: table.data.length,
      createdByUserId: userId,
    },
  });
  return { ok: true, importId };
}

const CHUNK = 500;

type ExitFailure = {
  ok: false;
  reason: "not_found" | "file";
  error: string;
};

export type CheckedExitImport = {
  ok: true;
  importId: string;
  status: ExitImportStatus;
  fileName: string;
  totalRows: number;
  result: ExitRowsValidation;
  /** Valid rows whose sale had already been imported before. */
  alreadyImported: Set<number>;
};

export const EXIT_IMPORT_STATUS_LABELS = {
  READY: "Lista para confirmar",
  CONFIRMED: "Confirmada, en espera",
  RUNNING: "Registrando salidas…",
  DONE: "Importada",
  FAILED: "No se pudo terminar",
  CANCELLED: "Cancelada",
} as const;

export type ExitImportStatus = keyof typeof EXIT_IMPORT_STATUS_LABELS;

/**
 * Reads the file of an import of exits again and checks every row
 * against the catalog and the locations of the company as they are now.
 * It writes nothing; review and confirmation both start from here.
 */
export async function checkExitImport(
  actor: InventoryActor,
  importId: string,
): Promise<CheckedExitImport | ExitFailure> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "inventory.import.read");
  const client = forOrganization(organizationId);
  const row = await client.exitImport.findFirst({
    where: { id: String(importId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      fileId: true,
      decimalSeparator: true,
      file: { select: { name: true } },
      organization: { select: { timeZone: true } },
    },
  });
  if (!row) {
    return {
      ok: false,
      reason: "not_found",
      error: "Esta importación ya no existe.",
    };
  }
  const file = await readStoredFile(organizationId, row.fileId);
  const content = file ? readSpreadsheet(file.name, file.bytes) : null;
  const table = content?.ok ? shape(content.rows) : null;
  if (!table) {
    return {
      ok: false,
      reason: "file",
      error:
        "El archivo de esta importación ya no se puede leer. Súbelo de nuevo.",
    };
  }
  const { mapping } = matchExitColumns(table.headers);
  const column = (key: ExitColumnKey) => {
    const index = mapping[key];
    return index === undefined
      ? []
      : [
          ...new Set(
            table.data
              .map(({ cells }) => (cells[index] ?? "").trim())
              .filter((text) => text !== "" && text.length <= 64),
          ),
        ];
  };
  // Only the products the file names, in pieces: a catalog can be large.
  const found = new Map<string, ExitProduct>();
  const load = async (field: "sku" | "barcode", values: string[]) => {
    for (let start = 0; start < values.length; start += CHUNK) {
      const chunk = values.slice(start, start + CHUNK);
      const products = await client.product.findMany({
        where:
          field === "sku" ? { sku: { in: chunk } } : { barcode: { in: chunk } },
        select: {
          id: true,
          sku: true,
          name: true,
          barcode: true,
          status: true,
          unitCode: true,
          quantityStep: true,
          presentations: { select: { id: true, name: true } },
        },
      });
      for (const product of products) {
        found.set(product.id, {
          ...product,
          quantityStep: product.quantityStep.toString(),
        });
      }
    }
  };
  await load("sku", column("sku"));
  await load("barcode", column("barcode"));

  const result = validateExitRows(table.data, {
    headers: table.headers,
    mapping,
    decimalSeparator: row.decimalSeparator === "," ? "," : ".",
    today: todayIn(row.organization.timeZone),
    products: [...found.values()],
    locations: await listStockLocations(actor),
  });

  // Sales of the file that an earlier import already took out of stock.
  const alreadyImported = new Set<number>();
  const keys = new Map(
    result.valid.map((line) => [
      exitKey(line.productId, line.externalId),
      line.row,
    ]),
  );
  const all = [...keys.keys()];
  for (let start = 0; start < all.length; start += CHUNK) {
    const applied = await client.exitImportRow.findMany({
      where: { appliedKey: { in: all.slice(start, start + CHUNK) } },
      select: { appliedKey: true },
    });
    for (const { appliedKey } of applied) {
      const line = appliedKey ? keys.get(appliedKey) : undefined;
      if (line !== undefined) alreadyImported.add(line);
    }
  }
  return {
    ok: true,
    importId: row.id,
    status: row.status,
    fileName: row.file.name,
    totalRows: table.data.length,
    result,
    alreadyImported,
  };
}

const MAX_ISSUES = 200;
const PREVIEW_ROWS = 20;

export type ExitImportReview =
  | {
      ok: true;
      id: string;
      status: ExitImportStatus;
      fileName: string;
      createdAt: Date;
      /** What the file says now; only while it can still be confirmed. */
      check: {
        totalRows: number;
        validRows: number;
        invalidRows: number;
        issues: ExitIssue[];
        issueCount: number;
        /** Sales already imported before: they will not leave stock again. */
        alreadyImported: number;
        /** Rows that will leave stock if confirmed now. */
        toApply: number;
        tickets: number;
        firstDay: string | null;
        lastDay: string | null;
        /** How the first rows are understood. */
        preview: {
          row: number;
          day: string;
          externalId: string;
          text: string;
        }[];
        ready: boolean;
      } | null;
      /** What became of it once confirmed. */
      progress: {
        totalRows: number;
        appliedRows: number;
        duplicateRows: number;
        failedRows: number;
        firstDay: string | null;
        lastDay: string | null;
        confirmedAt: Date | null;
        finishedAt: Date | null;
        lastError: string | null;
      };
    }
  | ExitFailure;

/** An import of exits with what its file says, or how it went. */
export async function reviewExitImport(
  actor: InventoryActor,
  importId: string,
): Promise<ExitImportReview> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "inventory.import.read");
  const row = await forOrganization(organizationId).exitImport.findFirst({
    where: { id: String(importId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      totalRows: true,
      appliedRows: true,
      duplicateRows: true,
      failedRows: true,
      firstDay: true,
      lastDay: true,
      confirmedAt: true,
      finishedAt: true,
      lastError: true,
      createdAt: true,
      file: { select: { name: true } },
    },
  });
  if (!row) {
    return {
      ok: false,
      reason: "not_found",
      error: "Esta importación ya no existe.",
    };
  }
  let check: Extract<ExitImportReview, { ok: true }>["check"] = null;
  if (row.status === "READY") {
    const checked = await checkExitImport(actor, row.id);
    if (!checked.ok) return checked;
    const { valid, issues, invalidRows } = checked.result;
    const days = valid.map((line) => line.day).sort();
    const toApply = valid.length - checked.alreadyImported.size;
    check = {
      totalRows: checked.totalRows,
      validRows: valid.length,
      invalidRows,
      issues: issues.slice(0, MAX_ISSUES),
      issueCount: issues.length,
      alreadyImported: checked.alreadyImported.size,
      toApply,
      tickets: new Set(valid.map((line) => foldName(line.externalId))).size,
      firstDay: days[0] ?? null,
      lastDay: days.at(-1) ?? null,
      preview: valid.slice(0, PREVIEW_ROWS).map((line) => ({
        row: line.row,
        day: line.day,
        externalId: line.externalId,
        text: `${line.productName} (${line.sku}): ${
          line.presentation
            ? `${line.quantity} × ${line.presentation.name}`
            : formatStock(line.quantity, line.unitCode)
        } de ${line.locationPath}${checked.alreadyImported.has(line.row) ? " · ya importada" : ""}`,
      })),
      ready: valid.length > 0 && invalidRows === 0,
    };
  }
  return {
    ok: true,
    id: row.id,
    status: row.status,
    fileName: row.file.name,
    createdAt: row.createdAt,
    check,
    progress: {
      totalRows: row.totalRows,
      appliedRows: row.appliedRows,
      duplicateRows: row.duplicateRows,
      failedRows: row.failedRows,
      firstDay: row.firstDay ? asDay(row.firstDay) : null,
      lastDay: row.lastDay ? asDay(row.lastDay) : null,
      confirmedAt: row.confirmedAt,
      finishedAt: row.finishedAt,
      lastError: row.lastError,
    },
  };
}

export type ConfirmExitImportResult =
  | { ok: true; rows: number; repeated?: true }
  | {
      ok: false;
      reason: "not_found" | "not_ready" | "file" | "forbidden";
      error: string;
    };

type ConfirmFailure = Extract<ConfirmExitImportResult, { ok: false }>;

/** Carries an expected failure out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: ConfirmFailure) {
    super("exit import not confirmed");
  }
}

/**
 * Confirms a file of exits: its rows are fixed — product, presentation,
 * location, quantity, day and folio — and a job is queued to register
 * them. Whoever confirms must be allowed to register exits by hand:
 * importing is not a way around that.
 */
export async function confirmExitImport(
  actor: InventoryActor,
  importId: string,
): Promise<ConfirmExitImportResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.import.confirm",
  );
  try {
    await assertModulePermission(
      organizationId,
      userId,
      "inventory.exit.create",
    );
  } catch (error) {
    if (!isAppError(error) || error.kind !== "forbidden") throw error;
    return {
      ok: false,
      reason: "forbidden",
      error:
        "Este archivo registra salidas y tu acceso no lo permite. Pide a un administrador que lo confirme.",
    };
  }
  // Read before the transaction (a whole file); the state of the import
  // is decided inside, under its lock.
  const checked = await checkExitImport(actor, importId);
  if (!checked.ok) return checked;
  const { valid, invalidRows } = checked.result;
  if (checked.status === "READY" && (valid.length === 0 || invalidRows > 0)) {
    return {
      ok: false,
      reason: "not_ready",
      error:
        "Este archivo todavía tiene filas por corregir. Corrígelo y súbelo de nuevo.",
    };
  }
  const days = valid.map((line) => line.day).sort();

  try {
    return await forOrganization(organizationId).$transaction(
      async (tx) => {
        // Two confirmations of the same import go one after the other.
        const [id] = await lockRows(tx, "exitImport", [checked.importId]);
        const row = id
          ? await tx.exitImport.findFirst({
              where: { id },
              select: { id: true, status: true, totalRows: true },
            })
          : null;
        if (!row) {
          throw new Rejected({
            ok: false,
            reason: "not_found",
            error: "Esta importación ya no existe.",
          });
        }
        if (row.status === "CANCELLED") {
          throw new Rejected({
            ok: false,
            reason: "not_ready",
            error: "Esta importación se canceló. Sube el archivo de nuevo.",
          });
        }
        if (row.status !== "READY") {
          // Already confirmed (a double click, a retry): once is enough.
          return {
            ok: true as const,
            rows: row.totalRows,
            repeated: true as const,
          };
        }
        const rows = valid.map((line) => ({
          id: newId(),
          organizationId,
          importId: row.id,
          row: line.row,
          externalId: line.externalId,
          day: asDate(line.day),
          productId: line.productId,
          presentationId: line.presentation?.id ?? null,
          quantity: line.quantity,
          locationId: line.locationId,
        }));
        for (let start = 0; start < rows.length; start += CHUNK) {
          await tx.exitImportRow.createMany({
            data: rows.slice(start, start + CHUNK),
          });
        }
        await tx.exitImport.updateMany({
          where: { id: row.id },
          data: {
            status: "CONFIRMED",
            totalRows: rows.length,
            firstDay: asDate(days[0]!),
            lastDay: asDate(days.at(-1)!),
            confirmedAt: new Date(),
            confirmedByUserId: userId,
          },
        });
        // The work exists only if the confirmation does.
        await enqueueJob(tx, organizationId, {
          type: EXIT_IMPORT_JOB_TYPE,
          payload: { importId: row.id },
          createdByUserId: userId,
        });
        await recordAuditEvent(tx, {
          organizationId,
          actorUserId: userId,
          action: "inventory.exit_import_confirmed",
          target: { type: "exit_import", id: row.id },
          metadata: {
            archivo: checked.fileName,
            filas: rows.length,
            desde: days[0],
            hasta: days.at(-1),
          },
        });
        return { ok: true as const, rows: rows.length };
      },
      { ...LOCKING_TRANSACTION, timeout: 60_000, maxWait: 15_000 },
    );
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

export type CancelExitImportResult =
  | { ok: true; applied: number; pending: number; repeated?: true }
  | { ok: false; reason: "not_found" | "finished"; error: string };

/**
 * Cancels an import of exits, before or while the worker registers it.
 * The exits already registered stay — they are movements, corrected with
 * a reversal — and the rest are not registered.
 */
export async function cancelExitImport(
  actor: InventoryActor,
  importId: string,
): Promise<CancelExitImportResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.import.cancel",
  );
  return forOrganization(organizationId).$transaction(async (tx) => {
    // The batch the worker has in hand ends first.
    const [id] = await lockRows(tx, "exitImport", [
      String(importId).slice(0, 36),
    ]);
    const row = id
      ? await tx.exitImport.findFirst({
          where: { id },
          select: {
            id: true,
            status: true,
            totalRows: true,
            appliedRows: true,
            duplicateRows: true,
            failedRows: true,
            file: { select: { name: true } },
          },
        })
      : null;
    if (!row) {
      return {
        ok: false as const,
        reason: "not_found" as const,
        error: "Esta importación ya no existe.",
      };
    }
    const pending =
      row.totalRows - row.appliedRows - row.duplicateRows - row.failedRows;
    if (row.status === "CANCELLED") {
      return {
        ok: true as const,
        applied: row.appliedRows,
        pending,
        repeated: true as const,
      };
    }
    if (row.status === "DONE" || row.status === "FAILED") {
      return {
        ok: false as const,
        reason: "finished" as const,
        error:
          row.status === "DONE"
            ? "Esta importación ya terminó: no queda nada por cancelar. Una salida registrada se corrige con una reversa."
            : "Esta importación ya se detuvo.",
      };
    }
    await tx.exitImport.updateMany({
      where: { id: row.id },
      data: { status: "CANCELLED", finishedAt: new Date(), lastError: null },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "inventory.exit_import_cancelled",
      target: { type: "exit_import", id: row.id },
      metadata: {
        archivo: row.file.name,
        salidasRegistradas: row.appliedRows,
        sinRegistrar: pending,
      },
    });
    return { ok: true as const, applied: row.appliedRows, pending };
  }, LOCKING_TRANSACTION);
}

export type ExitImportSummary = {
  id: string;
  fileName: string;
  status: ExitImportStatus;
  dataRows: number;
  appliedRows: number;
  failedRows: number;
  firstDay: string | null;
  lastDay: string | null;
  createdAt: Date;
};

/** Latest imports of exits of the company, newest first. */
export async function listExitImports(
  actor: InventoryActor,
): Promise<ExitImportSummary[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.import.read",
  );
  const rows = await forOrganization(actor.organizationId).exitImport.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 10,
    select: {
      id: true,
      status: true,
      dataRows: true,
      appliedRows: true,
      failedRows: true,
      firstDay: true,
      lastDay: true,
      createdAt: true,
      file: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    fileName: row.file.name,
    status: row.status,
    dataRows: row.dataRows,
    appliedRows: row.appliedRows,
    failedRows: row.failedRows,
    firstDay: row.firstDay ? asDay(row.firstDay) : null,
    lastDay: row.lastDay ? asDay(row.lastDay) : null,
    createdAt: row.createdAt,
  }));
}

export type ExitCoverage = {
  /** Last day with an imported exit (2026-10-09); null when there is none. */
  through: string | null;
  /** When the last exit of a file was registered. */
  updatedAt: Date | null;
  /** Rows of files that are still waiting or being registered. */
  inProgress: number;
  /**
   * Exits of files that could not be registered and are still missing:
   * stock is not up to date for them until they are imported again.
   */
  missing: number;
};

/**
 * Up to which day the exits of the business are imported: the answer to
 * «is my stock up to date?» when sales are kept outside the system.
 */
export async function getExitCoverage(
  actor: InventoryActor,
): Promise<ExitCoverage> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.import.read",
  );
  const client = forOrganization(actor.organizationId);
  const [last, latest, inProgress, failed] = await Promise.all([
    client.exitImportRow.findFirst({
      where: { status: "DONE" },
      orderBy: [{ day: "desc" }, { id: "desc" }],
      select: { day: true },
    }),
    client.exitImportRow.findFirst({
      where: { status: "DONE" },
      orderBy: [{ appliedAt: "desc" }, { id: "desc" }],
      select: { appliedAt: true },
    }),
    client.exitImportRow.count({
      where: {
        status: "PENDING",
        import: { status: { in: ["CONFIRMED", "RUNNING"] } },
      },
    }),
    client.exitImportRow.findMany({
      where: { status: "FAILED" },
      orderBy: [{ day: "desc" }, { id: "desc" }],
      take: 1_000,
      select: { productId: true, externalId: true },
    }),
  ]);
  // A failed row stops counting once the same sale got in with another file.
  const keys = [
    ...new Set(failed.map((row) => exitKey(row.productId, row.externalId))),
  ];
  let recovered = 0;
  for (let start = 0; start < keys.length; start += CHUNK) {
    recovered += await client.exitImportRow.count({
      where: { appliedKey: { in: keys.slice(start, start + CHUNK) } },
    });
  }
  return {
    through: last ? asDay(last.day) : null,
    updatedAt: latest?.appliedAt ?? null,
    inProgress,
    missing: keys.length - recovered,
  };
}

/** Rows of an import of exits that could not be registered, with the reason. */
export async function listExitImportFailures(
  actor: InventoryActor,
  importId: string,
): Promise<
  { row: number; externalId: string; sku: string; day: string; error: string }[]
> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.import.read",
  );
  const rows = await forOrganization(
    actor.organizationId,
  ).exitImportRow.findMany({
    where: { importId: String(importId).slice(0, 36), status: "FAILED" },
    orderBy: { row: "asc" },
    take: 200,
    select: {
      row: true,
      externalId: true,
      day: true,
      error: true,
      product: { select: { sku: true } },
    },
  });
  return rows.map((row) => ({
    row: row.row,
    externalId: row.externalId,
    sku: row.product.sku,
    day: asDay(row.day),
    error: row.error ?? "No se pudo registrar.",
  }));
}
