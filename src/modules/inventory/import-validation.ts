import "server-only";

import { dec, formatDecimal } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import {
  UNITS,
  defaultStep,
  getUnit,
  parseQuantity,
  pluralizeName,
} from "@/platform/catalog";
import { readSpreadsheet, readStoredFile } from "@/platform/files";
import { forOrganization } from "@/server";

import { IMPORT_COLUMNS, type ImportColumnKey } from "./import-template";
import {
  normalizeDecimal,
  type DecimalSeparator,
  type ImportMapping,
} from "./imports";
import {
  formatStock,
  listStockLocations,
  type InventoryActor,
} from "./movements";

/**
 * Validation of an import, cell by cell (IMP-05). Every row of the file
 * is read with the column map and the decimal separator the person chose
 * and checked against the same rules a manual capture follows. The result
 * says what is wrong, in which row and column, and how the rows that are
 * right will be understood. Nothing is written: not the catalog, not the
 * stock, not even the outcome of this check.
 */

export type ImportIssue = {
  /** Row of the file, as Excel numbers it. */
  row: number;
  /** Our column the problem is about; null when it is about the whole row. */
  column: ImportColumnKey | null;
  /** Title of that column in the person's file («Existencia»). */
  header: string;
  /** What the cell holds. */
  value: string;
  message: string;
};

/** A row that passed, as it will be understood. */
export type ValidImportRow = {
  row: number;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  barcode: string | null;
  unitCode: string;
  presentation: { name: string; content: string } | null;
  /** Initial stock of this row, in the product's unit; null when it has none. */
  stock: {
    base: string;
    /** As written: "3". */
    captured: string;
    inPresentation: boolean;
    locationId: string;
    locationPath: string;
  } | null;
  minimum: string | null;
};

export type RowsValidation = {
  valid: ValidImportRow[];
  issues: ImportIssue[];
  /** Rows with at least one problem. */
  invalidRows: number;
};

type Location = { id: string; path: string; isDefault: boolean };

/** Text to compare names: no accents, case or extra spaces. */
export const foldName = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** «Zona A › Estante 3», «zona a > estante 3» and «Zona A / Estante 3» alike. */
const foldPath = (path: string) =>
  path
    .split(/[›>/\\]/)
    .map(foldName)
    .filter(Boolean)
    .join(" > ");

const UNIT_BY_NAME = new Map<string, string>(
  UNITS.flatMap((unit) =>
    [unit.name, unit.plural, unit.symbol, unit.code].map(
      (name) => [foldName(name), unit.code] as const,
    ),
  ),
);

const hasControl = (text: string) => /[\u0000-\u001f\u007f]/.test(text);

/**
 * Checks the rows of a file. Pure: what it needs from the company (its
 * locations) comes as an argument.
 */
export function validateImportRows(
  rows: { row: number; cells: string[] }[],
  options: {
    headers: string[];
    mapping: ImportMapping;
    decimalSeparator: DecimalSeparator;
    locations: Location[];
  },
): RowsValidation {
  const { headers, mapping, decimalSeparator } = options;
  const general = options.locations.find((location) => location.isDefault);
  const locationByPath = new Map(
    options.locations.map((location) => [foldPath(location.path), location]),
  );
  const ourHeader = (key: ImportColumnKey) =>
    IMPORT_COLUMNS.find((column) => column.key === key)!.header;

  const issues: ImportIssue[] = [];
  const valid: ValidImportRow[] = [];
  let invalidRows = 0;
  /** First row of each SKU and what it said, to compare repetitions. */
  const firstBySku = new Map<
    string,
    {
      row: number;
      name: string;
      unitCode: string;
      locations: Set<string>;
      /** The presentation the product brings, from the first row that has one. */
      presentation: { name: string; content: string } | null;
    }
  >();
  const skuByBarcode = new Map<string, { sku: string; row: number }>();

  for (const { row, cells } of rows) {
    const cell = (key: ImportColumnKey) => {
      const index = mapping[key];
      return index === undefined ? "" : (cells[index] ?? "").trim();
    };
    let failed = false;
    const issue = (column: ImportColumnKey | null, message: string) => {
      failed = true;
      const index = column ? mapping[column] : undefined;
      issues.push({
        row,
        column,
        header:
          index !== undefined && headers[index]
            ? headers[index]
            : column
              ? ourHeader(column)
              : "",
        value: column ? cell(column) : "",
        message,
      });
    };
    /** Optional text with a maximum length. */
    const text = (key: ImportColumnKey, max: number): string | null => {
      const value = cell(key);
      if (value === "") return null;
      if (value.length > max) {
        issue(key, `Es demasiado largo: máximo ${max} caracteres.`);
        return null;
      }
      if (hasControl(value)) {
        issue(key, "Tiene saltos de línea o tabuladores: quítalos.");
        return null;
      }
      return value;
    };
    /** A number of the file, read with the chosen separator. */
    const number = (key: ImportColumnKey): string | null => {
      const value = cell(key);
      if (value === "") return null;
      const read = normalizeDecimal(value, decimalSeparator);
      if (!read.ok) {
        issue(key, read.error);
        return null;
      }
      if (read.value.startsWith("-")) {
        issue(key, "No puede ser negativo.");
        return null;
      }
      return read.value;
    };

    const sku = cell("sku");
    if (sku === "") issue("sku", "Falta la clave del producto.");
    else text("sku", 64);
    const name = cell("name");
    if (name.length < 2) {
      issue(
        "name",
        name === ""
          ? "Falta el nombre."
          : "El nombre necesita al menos 2 letras.",
      );
    } else text("name", 160);
    const description = text("description", 2000);
    const category = text("category", 80);
    const brand = text("brand", 80);
    const barcode = text("barcode", 64);

    const unitText = cell("unit");
    const unitCode = UNIT_BY_NAME.get(foldName(unitText)) ?? null;
    if (unitText === "") {
      issue("unit", "Falta la unidad: pieza, metro, kilogramo…");
    } else if (!unitCode) {
      issue(
        "unit",
        `«${unitText}» no es una unidad. Usa una de la lista (pieza, par, docena, kilogramo, gramo, metro, centímetro, milímetro, litro, mililitro, metro cuadrado). Una caja o un rollo van en «Presentación».`,
      );
    }
    // Quantities follow the rule a new product of that unit gets.
    const rule = unitCode
      ? { unitCode, quantityStep: defaultStep(unitCode) }
      : null;
    /** A quantity in the product's unit; zero means «none». */
    const quantity = (key: ImportColumnKey, value: string | null) => {
      if (value === null || !rule) return null;
      if (dec(value).isZero()) return dec(0);
      const parsed = parseQuantity(rule, value);
      if (!parsed.ok) {
        issue(key, parsed.error);
        return null;
      }
      return parsed.quantity;
    };

    // Presentation and content go together.
    const presentationName = text("presentation", 40);
    const contentText = number("presentationContent");
    let presentation: ValidImportRow["presentation"] = null;
    if (presentationName !== null && cell("presentationContent") === "") {
      issue(
        "presentationContent",
        `Falta cuánto trae «${presentationName}». Sin contenido no se puede convertir.`,
      );
    } else if (
      presentationName === null &&
      cell("presentationContent") !== ""
    ) {
      if (cell("presentation") === "") {
        issue(
          "presentation",
          "Hay contenido pero falta el nombre de la presentación (caja, rollo, saco…).",
        );
      }
    } else if (presentationName !== null && contentText !== null) {
      const content = quantity("presentationContent", contentText);
      if (content && content.isZero()) {
        issue("presentationContent", "El contenido debe ser mayor que cero.");
      } else if (content) {
        if (
          unitCode &&
          UNIT_BY_NAME.get(foldName(presentationName)) === unitCode
        ) {
          issue(
            "presentation",
            `«${presentationName}» es la unidad del producto, no una presentación. Déjala vacía.`,
          );
        } else {
          presentation = {
            name: presentationName,
            content: content.toString(),
          };
        }
      }
    }

    // Initial stock: in the unit, or in the presentation of this row.
    const stockText = number("initialStock");
    const countedIn = cell("initialStockIn");
    let stock: ValidImportRow["stock"] = null;
    if (stockText !== null && rule) {
      let base: ReturnType<typeof dec> | null = null;
      let inPresentation = false;
      const inUnit =
        countedIn === "" || UNIT_BY_NAME.get(foldName(countedIn)) === unitCode;
      if (inUnit) {
        base = quantity("initialStock", stockText);
      } else if (
        presentationName !== null &&
        foldName(countedIn) === foldName(presentationName)
      ) {
        if (presentation) {
          const count = dec(stockText);
          if (!count.isInteger()) {
            issue(
              "initialStock",
              `Las presentaciones se cuentan completas: escribe cuántas «${presentation.name}» hay, sin decimales, y lo suelto en otra fila.`,
            );
          } else {
            inPresentation = true;
            base = count.times(presentation.content);
            // Both what was counted and what it amounts to must fit.
            if (
              count.greaterThan("999999999.999") ||
              base.greaterThan("999999999.999")
            ) {
              issue("initialStock", "La cantidad es demasiado grande.");
              base = null;
            }
          }
        }
      } else {
        issue(
          "initialStockIn",
          presentationName
            ? `No coincide con la presentación de la fila («${presentationName}») ni con su unidad. Déjala vacía si la existencia está en ${getUnit(rule.unitCode).plural}.`
            : `Esta fila no tiene presentación: deja esta columna vacía, la existencia se toma en ${getUnit(rule.unitCode).plural}.`,
        );
      }
      const locationText = cell("location");
      const location =
        locationText === "" || foldPath(locationText) === "general"
          ? general
          : locationByPath.get(foldPath(locationText));
      if (!location) {
        issue(
          "location",
          `No existe la ubicación «${locationText}». Créala en Ubicaciones o corrige la ruta (por ejemplo «Zona A › Estante 3»).`,
        );
      } else if (base && !base.isZero()) {
        stock = {
          base: base.toString(),
          captured: stockText,
          inPresentation,
          locationId: location.id,
          locationPath: location.path,
        };
      }
    }

    const minimumQuantity = quantity("minimum", number("minimum"));
    const minimum =
      minimumQuantity && !minimumQuantity.isZero()
        ? minimumQuantity.toString()
        : null;

    // The same product in several rows: one per location, saying the same.
    if (sku !== "" && unitCode) {
      const key = foldName(sku);
      const first = firstBySku.get(key);
      const place = stock?.locationId ?? "";
      if (!first) {
        firstBySku.set(key, {
          row,
          name,
          unitCode,
          locations: new Set([place]),
          presentation,
        });
      } else if (
        foldName(first.name) !== foldName(name) ||
        first.unitCode !== unitCode
      ) {
        issue(
          "sku",
          `La clave ya está en la fila ${first.row} con otro nombre o unidad. Si es el mismo producto en otra ubicación, deja iguales nombre y unidad; si es otro, cámbiale la clave.`,
        );
      } else if (place === "" || first.locations.has(place)) {
        issue(
          "sku",
          place === ""
            ? `La clave ya está en la fila ${first.row}. Una clave solo se repite para dar la existencia de otra ubicación.`
            : `La clave ya está en la fila ${first.row} con la misma ubicación. Suma las existencias en una sola fila.`,
        );
      } else {
        first.locations.add(place);
      }
      // A product brings one presentation: its rows repeat it or leave it
      // empty, so the stock counted in it has a single content.
      if (first && presentation) {
        if (!first.presentation) {
          first.presentation = presentation;
        } else if (
          foldName(first.presentation.name) !== foldName(presentation.name) ||
          !dec(first.presentation.content).equals(presentation.content)
        ) {
          issue(
            "presentation",
            `Esta clave ya trae la presentación «${first.presentation.name}» de ${first.presentation.content} en otra fila. En las filas repetidas deja la misma presentación y contenido, o déjalos vacíos; las demás presentaciones se agregan después en el producto.`,
          );
        }
      }
    }
    if (barcode !== null && sku !== "") {
      const owner = skuByBarcode.get(barcode);
      if (!owner) skuByBarcode.set(barcode, { sku: foldName(sku), row });
      else if (owner.sku !== foldName(sku)) {
        issue(
          "barcode",
          `Ese código de barras ya lo tiene otro producto en la fila ${owner.row}.`,
        );
      }
    }

    if (failed) {
      invalidRows++;
      continue;
    }
    valid.push({
      row,
      sku,
      name,
      description,
      category,
      brand,
      barcode,
      unitCode: unitCode!,
      presentation,
      stock,
      minimum,
    });
  }
  return { valid, issues, invalidRows };
}

/** Problems kept to show; the count is always the real one. */
const MAX_ISSUES = 2_000;
const PREVIEW_ROWS = 10;

export type ImportValidation =
  | {
      ok: true;
      importId: string;
      fileName: string;
      totalRows: number;
      validRows: number;
      invalidRows: number;
      /** Different products among the rows that are right. */
      products: number;
      issueCount: number;
      /** In the order of the file; at most the first 2,000. */
      issues: ImportIssue[];
      /** How the first rows that are right will be understood. */
      preview: {
        row: number;
        sku: string;
        name: string;
        unit: string;
        /** «Caja de 100 piezas», or null. */
        presentation: string | null;
        /** «3 cajas × 100 = 300 piezas en General», or null. */
        stock: string | null;
        /** «200 piezas», or null. */
        minimum: string | null;
      }[];
    }
  | { ok: false; reason: "not_found" | "not_ready" | "file"; error: string };

type ImportFailure = Extract<ImportValidation, { ok: false }>;

/** An import read and checked whole: every row, right or wrong. */
export type CheckedImport = {
  ok: true;
  importId: string;
  fileName: string;
  totalRows: number;
  headers: string[];
  mapping: ImportMapping;
  result: RowsValidation;
};

/**
 * Reads the file of an import again and checks every row. The steps that
 * follow (classification, confirmation) start from here, so they always
 * work with what the file and the company say now.
 */
export async function checkImport(
  actor: InventoryActor,
  importId: string,
): Promise<CheckedImport | ImportFailure> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "inventory.import.read");
  const row = await forOrganization(organizationId).productImport.findFirst({
    where: { id: String(importId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      fileId: true,
      headerRow: true,
      headers: true,
      mapping: true,
      decimalSeparator: true,
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
  const separator = row.decimalSeparator;
  if (row.status === "MAPPING" || (separator !== "." && separator !== ",")) {
    return {
      ok: false,
      reason: "not_ready",
      error:
        "Primero elige las columnas y cómo vienen los decimales de tu archivo.",
    };
  }
  const file = await readStoredFile(organizationId, row.fileId);
  const content = file ? readSpreadsheet(file.name, file.bytes) : null;
  if (!content?.ok) {
    return {
      ok: false,
      reason: "file",
      error:
        "El archivo de esta importación ya no se puede leer. Súbelo de nuevo.",
    };
  }
  const headers = Array.isArray(row.headers) ? row.headers.map(String) : [];
  const mapping: ImportMapping = {};
  for (const column of IMPORT_COLUMNS) {
    const index = (row.mapping as Record<string, unknown> | null)?.[column.key];
    if (Number.isInteger(index)) mapping[column.key] = index as number;
  }
  const data = content.rows
    .map((cells, index) => ({ row: index + 1, cells }))
    .filter(
      ({ row: number, cells }) =>
        number > row.headerRow && cells.some((cell) => cell !== ""),
    );
  const locations = await listStockLocations(actor);
  const result = validateImportRows(data, {
    headers,
    mapping,
    decimalSeparator: separator,
    locations,
  });
  return {
    ok: true,
    importId: row.id,
    fileName: row.file.name,
    totalRows: data.length,
    headers,
    mapping,
    result,
  };
}

/**
 * Validates an import whose columns are set. It reads the file again and
 * answers with the problems found; it changes nothing, so it can be run
 * as many times as needed while the person corrects their file.
 */
export async function validateImport(
  actor: InventoryActor,
  importId: string,
): Promise<ImportValidation> {
  const checked = await checkImport(actor, importId);
  if (!checked.ok) return checked;
  const { result } = checked;

  return {
    ok: true,
    importId: checked.importId,
    fileName: checked.fileName,
    totalRows: checked.totalRows,
    validRows: result.valid.length,
    invalidRows: result.invalidRows,
    products: new Set(result.valid.map((line) => foldName(line.sku))).size,
    issueCount: result.issues.length,
    issues: result.issues.slice(0, MAX_ISSUES),
    preview: result.valid.slice(0, PREVIEW_ROWS).map((line) => {
      const unit = getUnit(line.unitCode);
      const content = line.presentation
        ? formatStock(line.presentation.content, line.unitCode)
        : null;
      return {
        row: line.row,
        sku: line.sku,
        name: line.name,
        unit: unit.name,
        presentation: line.presentation
          ? `${line.presentation.name} de ${content}`
          : null,
        stock: line.stock
          ? `${
              line.stock.inPresentation && line.presentation
                ? `${formatDecimal(line.stock.captured)} ${pluralizeName(line.presentation.name, dec(line.stock.captured))} × ${formatDecimal(line.presentation.content)} = `
                : ""
            }${formatStock(line.stock.base, line.unitCode)} en ${line.stock.locationPath}`
          : null,
        minimum: line.minimum ? formatStock(line.minimum, line.unitCode) : null,
      };
    }),
  };
}
