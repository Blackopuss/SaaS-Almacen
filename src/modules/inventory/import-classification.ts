import "server-only";

import type { Permission } from "@/platform/authorization";
import { getQuotaUsage } from "@/platform/entitlements";
import { forOrganization } from "@/server";

import {
  checkImport,
  foldName,
  type ImportIssue,
  type ValidImportRow,
} from "./import-validation";
import { IMPORT_COLUMNS, type ImportColumnKey } from "./import-template";
import type { InventoryActor } from "./movements";

/**
 * Classification of an import (IMP-06): which products of the file are
 * new, which already exist — the row updates them — and which are
 * archived and would come back. From that, how many places of the plan
 * the import needs and whether they fit. It reads the catalog as it is
 * now and writes nothing: the places are only taken when the import is
 * confirmed, so what is shown here is not yet a guarantee.
 */

export type ImportProductKind = "new" | "update" | "reactivate";

export type ClassifiedProduct = {
  /** First row of the file where the product appears. */
  row: number;
  sku: string;
  name: string;
  kind: ImportProductKind;
  /** What the file changes of a product that exists: «Nombre: A → B». */
  changes: string[];
};

export type ImportClassification =
  | {
      ok: true;
      importId: string;
      fileName: string;
      totalRows: number;
      validRows: number;
      /** Rows the review (IMP-05) found wrong; they block the import. */
      invalidRows: number;
      counts: Record<ImportProductKind, number>;
      /** Places of the plan: new products and those that come back. */
      quota: {
        /** Null when the company has no plan with a product quota. */
        limit: number | null;
        used: number;
        available: number;
        required: number;
        fits: boolean;
      };
      /** What the file asks that the catalog, as it is today, does not allow. */
      conflicts: ImportIssue[];
      conflictCount: number;
      /** Products of the file, in its order (the first ones). */
      products: ClassifiedProduct[];
      /** Everything is right and fits: the import could be confirmed. */
      ready: boolean;
    }
  | { ok: false; reason: "not_found" | "not_ready" | "file"; error: string };

const MAX_SHOWN = 200;
const CHUNK = 500;

/** A product of the file with everything its rows say, and what it is. */
export type PlannedProduct = {
  sku: string;
  kind: ImportProductKind;
  /** Its first row: the fields of the product. */
  first: ValidImportRow;
  /** Every row of it: one per location with stock. */
  rows: ValidImportRow[];
};

export type ImportPlan =
  | (Extract<ImportClassification, { ok: true }> & {
      /** Every product of the file, in its order; not only the ones shown. */
      entries: PlannedProduct[];
    })
  | Extract<ImportClassification, { ok: false }>;

/** The presentation a product of the file brings: the one its rows name. */
export const plannedPresentation = (entry: Pick<PlannedProduct, "rows">) =>
  entry.rows.find((line) => line.presentation)?.presentation ?? null;

/**
 * Permissions the operations of an import need, besides confirming it.
 * Importing is not a way around the manual controls: whoever confirms
 * must be allowed to do by hand everything the file does.
 */
export function importPermissions(
  entries: readonly PlannedProduct[],
): Permission[] {
  const needed = new Set<Permission>(["inventory.import.confirm"]);
  for (const { kind, first, rows } of entries) {
    needed.add(
      kind === "new"
        ? "inventory.product.create"
        : kind === "update"
          ? "inventory.product.update"
          : "inventory.product.reactivate",
    );
    if (plannedPresentation({ rows })) {
      needed.add("inventory.presentation.create");
      // On a product that exists the file may change its content.
      if (kind !== "new") needed.add("inventory.presentation.update");
    }
    if (first.minimum) needed.add("inventory.minimum.update");
    if (rows.some((line) => line.stock)) needed.add("inventory.opening.create");
  }
  return [...needed].sort();
}

/**
 * Classifies the products of an import against the catalog of the
 * company and tells how much quota it needs.
 */
export async function classifyImport(
  actor: InventoryActor,
  importId: string,
): Promise<ImportClassification> {
  const plan = await planImport(actor, importId);
  if (!plan.ok) return plan;
  // The screen gets the summary; the full list is for the confirmation.
  const classification: ImportClassification & { entries?: unknown } = {
    ...plan,
  };
  delete classification.entries;
  return classification;
}

/** The classification with every product of the file, for confirming it. */
export async function planImport(
  actor: InventoryActor,
  importId: string,
): Promise<ImportPlan> {
  // Checks the permission and reads the file again.
  const checked = await checkImport(actor, importId);
  if (!checked.ok) return checked;
  const { organizationId } = actor;
  const client = forOrganization(organizationId);
  const { valid } = checked.result;
  const header = (key: ImportColumnKey) => {
    const index = checked.mapping[key];
    return (
      (index !== undefined && checked.headers[index]) ||
      IMPORT_COLUMNS.find((column) => column.key === key)!.header
    );
  };

  // One entry per product of the file: its first row says what it is.
  const bySku = new Map<
    string,
    { first: ValidImportRow; rows: ValidImportRow[] }
  >();
  for (const line of valid) {
    const key = foldName(line.sku);
    const entry = bySku.get(key);
    if (entry) entry.rows.push(line);
    else bySku.set(key, { first: line, rows: [line] });
  }

  // What the catalog has today for those keys and barcodes.
  const skus = [...bySku.values()].map((entry) => entry.first.sku);
  const barcodes = [
    ...new Set(valid.flatMap((line) => (line.barcode ? [line.barcode] : []))),
  ];
  const select = {
    id: true,
    sku: true,
    name: true,
    status: true,
    unitCode: true,
    barcode: true,
    description: true,
    category: { select: { name: true } },
    brand: { select: { name: true } },
  } as const;
  type Existing = Awaited<
    ReturnType<typeof client.product.findMany<{ select: typeof select }>>
  >[number];
  const existing = new Map<string, Existing>();
  for (let start = 0; start < skus.length; start += CHUNK) {
    const found = await client.product.findMany({
      where: { sku: { in: skus.slice(start, start + CHUNK) } },
      select,
    });
    for (const product of found) existing.set(foldName(product.sku), product);
  }
  const barcodeOwner = new Map<string, string>();
  for (let start = 0; start < barcodes.length; start += CHUNK) {
    const found = await client.product.findMany({
      where: { barcode: { in: barcodes.slice(start, start + CHUNK) } },
      select: { sku: true, barcode: true },
    });
    for (const product of found) {
      if (product.barcode) barcodeOwner.set(product.barcode, product.sku);
    }
  }
  // Products that already have movements: their stock is no longer
  // «initial», and their unit is fixed.
  const moved = new Set<string>();
  const existingIds = [...existing.values()].map((product) => product.id);
  for (let start = 0; start < existingIds.length; start += CHUNK) {
    const lines = await client.stockMovementLine.groupBy({
      by: ["productId"],
      where: { productId: { in: existingIds.slice(start, start + CHUNK) } },
    });
    for (const line of lines) moved.add(line.productId);
  }

  const conflicts: ImportIssue[] = [];
  const conflict = (
    line: ValidImportRow,
    column: ImportColumnKey,
    value: string,
    message: string,
  ) =>
    conflicts.push({
      row: line.row,
      column,
      header: header(column),
      value,
      message,
    });

  const counts: Record<ImportProductKind, number> = {
    new: 0,
    update: 0,
    reactivate: 0,
  };
  const products: ClassifiedProduct[] = [];
  const entries: PlannedProduct[] = [];
  for (const [key, { first, rows }] of bySku) {
    const current = existing.get(key);
    const kind: ImportProductKind = !current
      ? "new"
      : current.status === "ACTIVE"
        ? "update"
        : "reactivate";
    counts[kind]++;
    entries.push({ sku: current?.sku ?? first.sku, kind, first, rows });

    const changes: string[] = [];
    if (current) {
      const differs = (
        label: string,
        before: string | null | undefined,
        after: string | null,
      ) => {
        // An empty cell leaves what the product has: it erases nothing.
        if (after !== null && foldName(after) !== foldName(before ?? "")) {
          changes.push(`${label}: ${before || "(vacío)"} → ${after}`);
        }
      };
      differs("Nombre", current.name, first.name);
      differs("Descripción", current.description, first.description);
      differs("Categoría", current.category?.name, first.category);
      differs("Marca", current.brand?.name, first.brand);
      differs("Código de barras", current.barcode, first.barcode);
      if (kind === "reactivate") changes.unshift("Está archivado: se reactiva");
      if (first.unitCode !== current.unitCode) {
        conflict(
          first,
          "unit",
          first.unitCode,
          `${current.sku} ya existe y se controla en otra unidad. La unidad de un producto no se cambia al importar: corrígela en el archivo o cambia la clave.`,
        );
      }
      if (moved.has(current.id)) {
        for (const line of rows.filter((item) => item.stock)) {
          conflict(
            line,
            "initialStock",
            line.stock!.captured,
            `${current.sku} ya tiene movimientos: su existencia ya no es «inicial». Deja vacía esta celda y corrige la cantidad con un ajuste o un conteo.`,
          );
        }
      }
    }
    for (const line of rows) {
      const owner = line.barcode ? barcodeOwner.get(line.barcode) : undefined;
      if (owner && foldName(owner) !== key) {
        conflict(
          line,
          "barcode",
          line.barcode!,
          `Ese código de barras ya lo tiene el producto ${owner} de tu catálogo.`,
        );
      }
    }
    if (products.length < MAX_SHOWN) {
      products.push({
        row: first.row,
        sku: current?.sku ?? first.sku,
        name: first.name,
        kind,
        changes,
      });
    }
  }
  conflicts.sort((a, b) => a.row - b.row);

  const usage = await getQuotaUsage(organizationId, "active_products");
  const required = counts.new + counts.reactivate;
  const fits = usage.limit !== null && required <= usage.available;
  return {
    ok: true,
    importId: checked.importId,
    fileName: checked.fileName,
    totalRows: checked.totalRows,
    validRows: valid.length,
    invalidRows: checked.result.invalidRows,
    counts,
    quota: {
      limit: usage.limit,
      used: usage.used + usage.reserved,
      available: usage.available,
      required,
      fits,
    },
    conflicts: conflicts.slice(0, MAX_SHOWN),
    conflictCount: conflicts.length,
    products,
    entries,
    ready:
      valid.length > 0 &&
      checked.result.invalidRows === 0 &&
      conflicts.length === 0 &&
      fits,
  };
}
