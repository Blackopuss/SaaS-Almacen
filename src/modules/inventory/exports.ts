import "server-only";

import { recordAuditEvent } from "@/platform/audit";
import type { Permission } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import { getUnit } from "@/platform/catalog";
import { buildCsv, buildXlsx, type Cell } from "@/platform/files";
import { formatLocationPath } from "@/platform/locations";
import { forOrganization } from "@/server";

import {
  MOVEMENT_TYPE_LABELS,
  startOfDay,
  type InventoryActor,
} from "./movements";

/**
 * Exports to a spreadsheet (IMP-11): the catalog, the stock and the
 * history of movements of the company, in Excel or CSV.
 *
 * Two rules. What goes out is what the person may already see on screen:
 * besides the permission to export, each export asks for the permission
 * to read what it contains. And every cell is written as text through
 * `buildCsv`/`buildXlsx`, which neutralize anything a spreadsheet would
 * run as a formula: a product named «=HYPERLINK(…)» arrives as that text,
 * not as a link.
 */

export const EXPORT_KINDS = {
  catalogo: {
    label: "Catálogo de productos",
    file: "catalogo",
    sheet: "Catálogo",
    reads: "inventory.product.read",
  },
  existencias: {
    label: "Existencias por ubicación",
    file: "existencias",
    sheet: "Existencias",
    reads: "inventory.stock.read",
  },
  movimientos: {
    label: "Historial de movimientos",
    file: "movimientos",
    sheet: "Movimientos",
    reads: "inventory.movement.read",
  },
} as const satisfies Record<
  string,
  { label: string; file: string; sheet: string; reads: Permission }
>;

export type ExportKind = keyof typeof EXPORT_KINDS;
export type ExportFormat = "xlsx" | "csv";

export const isExportKind = (value: unknown): value is ExportKind =>
  typeof value === "string" && Object.hasOwn(EXPORT_KINDS, value);

/** Rows a file holds at most; more than this is asked for in parts. */
export const EXPORT_MAX_ROWS = 50_000;
/** Rows read from the database at a time. */
const PAGE = 500;

export type ExportResult =
  | {
      ok: true;
      name: string;
      contentType: string;
      bytes: Buffer;
      /** Rows of data, without the titles. */
      rows: number;
    }
  | { ok: false; reason: "dates" | "too_large"; error: string };

type Failure = Extract<ExportResult, { ok: false }>;

/** Carries an expected refusal out of the reading loop. */
class Refused extends Error {
  constructor(readonly result: Failure) {
    super("export refused");
  }
}

const tooLarge = (hint: string): Failure => ({
  ok: false,
  reason: "too_large",
  error: `Son más de ${EXPORT_MAX_ROWS.toLocaleString("es-MX")} filas para un solo archivo. ${hint}`,
});

/**
 * Reads every row of a query, a page at a time, in the order of its ids
 * (unique within the company, so the order is stable and each page starts
 * where the last one ended).
 */
async function readAll<Row extends { id: string }>(
  page: (after: string | null) => Promise<Row[]>,
  full: () => Failure,
): Promise<Row[]> {
  const rows: Row[] = [];
  let after: string | null = null;
  for (;;) {
    const batch = await page(after);
    rows.push(...batch);
    if (rows.length > EXPORT_MAX_ROWS) throw new Refused(full());
    if (batch.length < PAGE) return rows;
    after = batch.at(-1)!.id;
  }
}

const afterId = (after: string | null) => (after ? { id: { gt: after } } : {});

type Client = ReturnType<typeof forOrganization>;

/** Path of every location of the company, archived ones included. */
async function locationPaths(client: Client): Promise<Map<string, string>> {
  const locations = await client.location.findMany({
    take: 5_000,
    select: {
      id: true,
      name: true,
      parent: { select: { name: true, parent: { select: { name: true } } } },
    },
  });
  return new Map(
    locations.map((location) => [
      location.id,
      formatLocationPath(
        [
          location.parent?.parent?.name,
          location.parent?.name,
          location.name,
        ].filter((name): name is string => Boolean(name)),
      ),
    ]),
  );
}

async function catalogRows(client: Client): Promise<Cell[][]> {
  const products = await readAll(
    (after) =>
      client.product.findMany({
        where: afterId(after),
        orderBy: { id: "asc" },
        take: PAGE,
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          barcode: true,
          unitCode: true,
          status: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
        },
      }),
    () => tooLarge("Escríbenos para preparar tu catálogo completo."),
  );
  const minimums = new Map(
    (
      await client.stockMinimum.findMany({
        take: EXPORT_MAX_ROWS,
        select: { productId: true, quantity: true },
      })
    ).map((minimum) => [minimum.productId, minimum.quantity.toString()]),
  );
  products.sort((a, b) => a.sku.localeCompare(b.sku, "es"));
  return [
    [
      "Clave (SKU)",
      "Nombre",
      "Descripción",
      "Categoría",
      "Marca",
      "Código de barras",
      "Unidad",
      "Estado",
      "Mínimo",
    ],
    ...products.map((product): Cell[] => [
      product.sku,
      product.name,
      product.description ?? "",
      product.category?.name ?? "",
      product.brand?.name ?? "",
      product.barcode ?? "",
      getUnit(product.unitCode).name,
      product.status === "ACTIVE" ? "Activo" : "Archivado",
      minimums.get(product.id) ?? "",
    ]),
  ];
}

async function stockRows(client: Client): Promise<Cell[][]> {
  const [balances, paths] = await Promise.all([
    readAll(
      (after) =>
        client.stockBalance.findMany({
          where: { ...afterId(after), quantity: { gt: 0 } },
          orderBy: { id: "asc" },
          take: PAGE,
          select: {
            id: true,
            quantity: true,
            locationId: true,
            product: { select: { sku: true, name: true, unitCode: true } },
          },
        }),
      () => tooLarge("Escríbenos para preparar tus existencias completas."),
    ),
    locationPaths(client),
  ]);
  const rows = balances.map((balance) => ({
    sku: balance.product.sku,
    name: balance.product.name,
    location: paths.get(balance.locationId) ?? "",
    // The exact decimal, as text: never a floating-point number.
    quantity: balance.quantity.toString(),
    unit: getUnit(balance.product.unitCode).name,
  }));
  rows.sort(
    (a, b) =>
      a.sku.localeCompare(b.sku, "es") ||
      a.location.localeCompare(b.location, "es"),
  );
  return [
    ["Clave (SKU)", "Producto", "Ubicación", "Cantidad", "Unidad"],
    ...rows.map((row): Cell[] => [
      row.sku,
      row.name,
      row.location,
      row.quantity,
      row.unit,
    ]),
  ];
}

/** «2026-10-09 14:05», in the time zone of the company. */
function localStamp(moment: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(moment)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

const nextDay = (day: string) => {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

async function movementRows(
  client: Client,
  range: { from?: string; to?: string },
): Promise<Cell[][]> {
  const company = await client.membership.findFirst({
    select: { organization: { select: { timeZone: true } } },
  });
  const timeZone = company?.organization.timeZone ?? "America/Mexico_City";
  // Days of the company's calendar, both included (as in the history).
  const from = range.from ? startOfDay(range.from, timeZone) : null;
  const until = range.to ? startOfDay(nextDay(range.to), timeZone) : null;
  if ((range.from && !from) || (range.to && !until)) {
    throw new Refused({
      ok: false,
      reason: "dates",
      error: "Escribe las fechas como día de calendario: 2026-10-09.",
    });
  }
  if (from && until && from >= until) {
    throw new Refused({
      ok: false,
      reason: "dates",
      error: "La fecha inicial debe ser anterior o igual a la final.",
    });
  }
  const created = {
    ...(from ? { gte: from } : {}),
    ...(until ? { lt: until } : {}),
  };
  let lineCount = 0;
  const movements = await readAll(
    async (after) => {
      // Ids are UUIDv7: their order is the order of creation.
      const batch = await client.stockMovement.findMany({
        where: {
          ...afterId(after),
          ...(from || until ? { createdAt: created } : {}),
        },
        orderBy: { id: "asc" },
        take: PAGE,
        select: {
          id: true,
          type: true,
          createdAt: true,
          createdByUserId: true,
          reason: true,
          reference: true,
          lines: {
            orderBy: { lineNumber: "asc" },
            select: {
              locationId: true,
              direction: true,
              baseQuantity: true,
              unitCode: true,
              capturedQuantity: true,
              capturedUnitCode: true,
              presentation: { select: { name: true } },
              product: { select: { sku: true, name: true } },
            },
          },
        },
      });
      lineCount += batch.reduce((sum, item) => sum + item.lines.length, 0);
      if (lineCount > EXPORT_MAX_ROWS) {
        throw new Refused(
          tooLarge("Elige un rango de fechas más corto y expórtalo en partes."),
        );
      }
      return batch;
    },
    () => tooLarge("Elige un rango de fechas más corto y expórtalo en partes."),
  );
  const authorIds = [...new Set(movements.map((item) => item.createdByUserId))];
  const authors = new Map<string, string>();
  for (let start = 0; start < authorIds.length; start += PAGE) {
    const members = await client.membership.findMany({
      where: { userId: { in: authorIds.slice(start, start + PAGE) } },
      select: { userId: true, user: { select: { name: true } } },
    });
    for (const member of members) authors.set(member.userId, member.user.name);
  }
  const paths = await locationPaths(client);
  return [
    [
      "Fecha y hora",
      "Tipo",
      "Clave (SKU)",
      "Producto",
      "Ubicación",
      "Sentido",
      "Cantidad",
      "Unidad",
      "Capturado",
      "Capturado en",
      "Motivo",
      "Referencia",
      "Quién",
    ],
    ...movements.flatMap((movement) =>
      movement.lines.map((line): Cell[] => [
        localStamp(movement.createdAt, timeZone),
        MOVEMENT_TYPE_LABELS[movement.type],
        line.product.sku,
        line.product.name,
        paths.get(line.locationId) ?? "",
        line.direction === "IN" ? "Entrada" : "Salida",
        line.baseQuantity.toString(),
        getUnit(line.unitCode).name,
        line.presentation || line.capturedUnitCode
          ? line.capturedQuantity.toString()
          : "",
        line.presentation?.name ??
          (line.capturedUnitCode ? getUnit(line.capturedUnitCode).name : ""),
        movement.reason ?? "",
        movement.reference ?? "",
        authors.get(movement.createdByUserId) ?? "",
      ]),
    ),
  ];
}

/**
 * Builds an export of the company. The person must be allowed to export
 * and to read what the file contains; the file is only ever made of rows
 * of their company.
 */
export async function buildExport(
  actor: InventoryActor,
  input: {
    kind: ExportKind;
    format: ExportFormat;
    /** History only: first and last day (2026-10-09), both included. */
    from?: string;
    to?: string;
  },
): Promise<ExportResult> {
  const { organizationId, userId } = actor;
  const kind = EXPORT_KINDS[input.kind];
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.export.create",
  );
  // Exporting gives no more than the screen does.
  await assertModulePermission(organizationId, userId, kind.reads);

  const client = forOrganization(organizationId);
  let rows: Cell[][];
  try {
    rows =
      input.kind === "catalogo"
        ? await catalogRows(client)
        : input.kind === "existencias"
          ? await stockRows(client)
          : await movementRows(client, { from: input.from, to: input.to });
  } catch (error) {
    if (error instanceof Refused) return error.result;
    throw error;
  }
  const format: ExportFormat = input.format === "csv" ? "csv" : "xlsx";
  const bytes =
    format === "csv"
      ? buildCsv(rows)
      : buildXlsx([{ name: kind.sheet, rows, headerRows: 1 }]);
  const today = new Date().toISOString().slice(0, 10);
  await recordAuditEvent(client, {
    organizationId,
    actorUserId: userId,
    action: "inventory.export_created",
    target: { type: "export", id: input.kind },
    metadata: {
      contenido: kind.label,
      formato: format,
      filas: rows.length - 1,
      ...(input.kind === "movimientos" && (input.from || input.to)
        ? { desde: input.from ?? "", hasta: input.to ?? "" }
        : {}),
    },
  });
  return {
    ok: true,
    name: `${kind.file}-${today}.${format}`,
    contentType:
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
    rows: rows.length - 1,
  };
}
