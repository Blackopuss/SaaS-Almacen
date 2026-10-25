import "server-only";

import { dec, formatDecimal, isAppError } from "@/lib";
import { startOfDay } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { getUnit, pluralizeName } from "@/platform/catalog";
import { buildCsv, buildXlsx, type Cell } from "@/platform/files";
import { forOrganization } from "@/server";

import { PURCHASE_ORDER_STATUS_LABELS } from "./order-states";
import { formatOrderNumber } from "./orders";
import type { PurchasingActor } from "./product-suppliers";
import { inTermsOf, receivedByLine } from "./receipts";

/**
 * Reports of Compras (CMP-15): what is still to be received, and what was
 * bought from each supplier in a period. Both are worked out from orders,
 * receipts and returns each time; nothing is stored. Amounts exist only
 * for who may see costs (`purchasing.cost.read`): for the rest the fields
 * are not in the answer and the columns are not in the files (NEG-04,
 * NEG-25).
 */

type Decimal = ReturnType<typeof dec>;

/** Lines a report holds at most (as an export, IMP-11). */
export const REPORT_MAX_ROWS = 5_000;

const money = (amount: Decimal) => `$${formatDecimal(amount, { minScale: 2 })}`;

/** Whether the person may see costs: never an error, just yes or no. */
async function mayReadCosts(actor: PurchasingActor): Promise<boolean> {
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "purchasing.cost.read",
    );
    return true;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return false;
    throw error;
  }
}

/** «2026-10-15» of a moment, in the calendar of the company. */
function dayOf(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
}

const nextDay = (day: string) => {
  const date = new Date(`${day}T12:00:00.000Z`);
  // Not a day («2026-13-01», «x»): no next day, so the range is refused.
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

async function timeZoneOf(organizationId: string): Promise<string> {
  const company = await forOrganization(organizationId).membership.findFirst({
    select: { organization: { select: { timeZone: true } } },
  });
  return company?.organization.timeZone || "America/Mexico_City";
}

export type PendingRow = {
  orderId: string;
  numberText: string;
  statusLabel: string;
  supplierName: string;
  /** Day it is expected («2026-10-20»), or null. */
  expectedOn: string | null;
  /** Expected before today and still missing something. */
  late: boolean;
  sku: string;
  productName: string;
  /** «3 cajas», «25 piezas». */
  orderedText: string;
  receivedText: string | null;
  pendingText: string;
  /** Plain numbers for files: "2". */
  pendingQuantity: string;
  /** «cajas», «piezas». */
  unitText: string;
  /** What is pending is worth, at the cost of the line. Absent without costs. */
  pendingAmountText?: string | null;
  pendingAmount?: string | null;
};

export type PendingReport = {
  rows: PendingRow[];
  /** Orders with something to receive. */
  orders: number;
  costsVisible: boolean;
  /** Sum of what is pending with a cost. Absent without costs. */
  totalText?: string;
  /** More lines than a report holds: the first ones are shown. */
  truncated: boolean;
};

/**
 * What is still to be received (CMP-15): every line of a sent order or
 * one received in part with something missing, the most overdue first.
 * Closed and cancelled orders expect nothing.
 */
export async function getPendingReport(
  actor: PurchasingActor,
): Promise<PendingReport> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.report.read",
  );
  const costsVisible = await mayReadCosts(actor);
  const client = forOrganization(actor.organizationId);
  const timeZone = await timeZoneOf(actor.organizationId);
  const today = dayOf(new Date(), timeZone);
  const lines = await client.purchaseOrderLine.findMany({
    where: { order: { status: { in: ["SENT", "PARTIAL"] } } },
    orderBy: [{ orderId: "asc" }, { lineNumber: "asc" }],
    take: REPORT_MAX_ROWS + 1,
    select: {
      id: true,
      capturedQuantity: true,
      unitCode: true,
      ...(costsVisible ? { unitCost: true } : {}),
      product: { select: { name: true, sku: true } },
      presentation: { select: { name: true } },
      order: {
        select: {
          id: true,
          number: true,
          status: true,
          expectedOn: true,
          contact: { select: { name: true } },
        },
      },
    },
  });
  const truncated = lines.length > REPORT_MAX_ROWS;
  const kept = lines.slice(0, REPORT_MAX_ROWS);
  const received = await receivedByLine(
    client,
    kept.map((line) => line.id),
  );
  let total = dec(0);
  const rows: PendingRow[] = [];
  for (const line of kept) {
    const ordered = dec(line.capturedQuantity.toString());
    const got = received.get(line.id) ?? dec(0);
    const left = ordered.minus(got);
    if (left.lessThanOrEqualTo(0)) continue;
    const expectedOn = line.order.expectedOn
      ? line.order.expectedOn.toISOString().slice(0, 10)
      : null;
    const row: PendingRow = {
      orderId: line.order.id,
      numberText: formatOrderNumber(line.order.number),
      statusLabel: PURCHASE_ORDER_STATUS_LABELS[line.order.status],
      supplierName: line.order.contact.name,
      expectedOn,
      late: expectedOn !== null && expectedOn < today,
      sku: line.product.sku,
      productName: line.product.name,
      orderedText: inTermsOf(ordered, line.presentation, line.unitCode),
      receivedText: got.greaterThan(0)
        ? inTermsOf(got, line.presentation, line.unitCode)
        : null,
      pendingText: inTermsOf(left, line.presentation, line.unitCode),
      pendingQuantity: left.toFixed(),
      unitText: line.presentation
        ? pluralizeName(line.presentation.name, dec(2)).toLowerCase()
        : getUnit(line.unitCode).plural,
    };
    if (costsVisible) {
      const cost = (line as { unitCost?: { toString(): string } | null })
        .unitCost;
      const amount = cost ? left.times(cost.toString()) : null;
      if (amount) total = total.plus(amount);
      row.pendingAmount = amount ? amount.toFixed(2) : null;
      row.pendingAmountText = amount ? money(amount) : null;
    }
    rows.push(row);
  }
  rows.sort(
    (a, b) =>
      (a.expectedOn ?? "9999").localeCompare(b.expectedOn ?? "9999") ||
      a.numberText.localeCompare(b.numberText),
  );
  return {
    rows,
    orders: new Set(rows.map((row) => row.orderId)).size,
    costsVisible,
    ...(costsVisible ? { totalText: money(total) } : {}),
    truncated,
  };
}

export type SupplierRow = {
  supplierId: string;
  supplierName: string;
  /** Receipts in the period. */
  receipts: number;
  /** Orders those receipts belong to. */
  orders: number;
  /** Different products received. */
  products: number;
  /** Returns in the period. */
  returns: number;
  /** Absent without costs. */
  receivedAmountText?: string;
  returnedAmountText?: string;
  netAmountText?: string;
  receivedAmount?: string;
  returnedAmount?: string;
  netAmount?: string;
  /** Received lines with no cost: their amount is unknown. */
  linesWithoutCost?: number;
};

export type SupplierReport =
  | {
      ok: true;
      /** Days of the company's calendar, both included. */
      from: string;
      to: string;
      rows: SupplierRow[];
      costsVisible: boolean;
      /** Absent without costs. */
      totalText?: string;
      /** More receipts or returns than a report holds: the totals miss some. */
      truncated: boolean;
    }
  | { ok: false; error: string };

/**
 * What was bought from each supplier in a period (CMP-15): receipts and
 * returns between two days of the company's calendar (by default, this
 * month), with amounts at the cost of each line for who may see them.
 */
export async function getPurchasesBySupplier(
  actor: PurchasingActor,
  range: { from?: string; to?: string } = {},
): Promise<SupplierReport> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.report.read",
  );
  const costsVisible = await mayReadCosts(actor);
  const timeZone = await timeZoneOf(actor.organizationId);
  const today = dayOf(new Date(), timeZone);
  const fromDay = range.from?.trim() || `${today.slice(0, 8)}01`;
  const toDay = range.to?.trim() || today;
  const start = startOfDay(fromDay, timeZone);
  const end = startOfDay(nextDay(toDay), timeZone);
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) {
    return {
      ok: false,
      error: "Escribe las fechas como día de calendario: 2026-10-09.",
    };
  }
  if (start >= end) {
    return {
      ok: false,
      error: "La fecha inicial debe ser anterior o igual a la final.",
    };
  }
  const client = forOrganization(actor.organizationId);
  const when = { gte: start, lt: end };
  const receiptRows = await client.purchaseReceipt.findMany({
    where: { createdAt: when },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: REPORT_MAX_ROWS + 1,
    select: {
      orderId: true,
      order: {
        select: { contactId: true, contact: { select: { name: true } } },
      },
      lines: {
        select: {
          productId: true,
          capturedQuantity: true,
          ...(costsVisible ? { unitCost: true } : {}),
        },
      },
    },
  });
  const returnRows = await client.purchaseReturn.findMany({
    where: { createdAt: when },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: REPORT_MAX_ROWS + 1,
    select: {
      receipt: {
        select: {
          order: {
            select: { contactId: true, contact: { select: { name: true } } },
          },
        },
      },
      lines: {
        select: {
          capturedQuantity: true,
          ...(costsVisible
            ? { receiptLine: { select: { unitCost: true } } }
            : {}),
        },
      },
    },
  });

  const truncated =
    receiptRows.length > REPORT_MAX_ROWS || returnRows.length > REPORT_MAX_ROWS;
  const receipts = receiptRows.slice(0, REPORT_MAX_ROWS);
  const returns = returnRows.slice(0, REPORT_MAX_ROWS);

  type Acc = {
    name: string;
    receipts: number;
    orders: Set<string>;
    products: Set<string>;
    returns: number;
    received: Decimal;
    returned: Decimal;
    withoutCost: number;
  };
  const bySupplier = new Map<string, Acc>();
  const accOf = (id: string, name: string) => {
    const found = bySupplier.get(id);
    if (found) return found;
    const fresh: Acc = {
      name,
      receipts: 0,
      orders: new Set(),
      products: new Set(),
      returns: 0,
      received: dec(0),
      returned: dec(0),
      withoutCost: 0,
    };
    bySupplier.set(id, fresh);
    return fresh;
  };
  type CostOf = { unitCost?: { toString(): string } | null };
  for (const receipt of receipts) {
    const acc = accOf(receipt.order.contactId, receipt.order.contact.name);
    acc.receipts += 1;
    acc.orders.add(receipt.orderId);
    for (const line of receipt.lines) {
      acc.products.add(line.productId);
      const cost = (line as CostOf).unitCost;
      if (cost) {
        acc.received = acc.received.plus(
          dec(line.capturedQuantity.toString()).times(cost.toString()),
        );
      } else {
        acc.withoutCost += 1;
      }
    }
  }
  for (const back of returns) {
    const order = back.receipt.order;
    const acc = accOf(order.contactId, order.contact.name);
    acc.returns += 1;
    for (const line of back.lines) {
      const cost = (line as { receiptLine?: CostOf }).receiptLine?.unitCost;
      if (cost) {
        acc.returned = acc.returned.plus(
          dec(line.capturedQuantity.toString()).times(cost.toString()),
        );
      }
    }
  }

  let total = dec(0);
  const rows = [...bySupplier.entries()]
    .map(([supplierId, acc]): SupplierRow => {
      const row: SupplierRow = {
        supplierId,
        supplierName: acc.name,
        receipts: acc.receipts,
        orders: acc.orders.size,
        products: acc.products.size,
        returns: acc.returns,
      };
      if (!costsVisible) return row;
      const net = acc.received.minus(acc.returned);
      total = total.plus(net);
      return {
        ...row,
        receivedAmount: acc.received.toFixed(2),
        returnedAmount: acc.returned.toFixed(2),
        netAmount: net.toFixed(2),
        receivedAmountText: money(acc.received),
        returnedAmountText: money(acc.returned),
        netAmountText: money(net),
        linesWithoutCost: acc.withoutCost,
      };
    })
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName, "es"));
  return {
    ok: true,
    from: fromDay,
    to: toDay,
    rows,
    costsVisible,
    ...(costsVisible ? { totalText: money(total) } : {}),
    truncated,
  };
}

export const PURCHASE_REPORT_KINDS = {
  pendientes: { label: "Pendientes por recibir", sheet: "Pendientes" },
  proveedores: { label: "Compras por proveedor", sheet: "Por proveedor" },
} as const;

export type PurchaseReportKind = keyof typeof PURCHASE_REPORT_KINDS;

export const isPurchaseReportKind = (
  value: unknown,
): value is PurchaseReportKind =>
  typeof value === "string" && Object.hasOwn(PURCHASE_REPORT_KINDS, value);

export type PurchaseReportFile =
  | { ok: true; name: string; contentType: string; bytes: Buffer; rows: number }
  | { ok: false; error: string };

/**
 * A report as a file (CMP-15). Needs `purchasing.report.export` and reads
 * through the same services as the screen, so the file never holds more
 * than the screen shows: without costs, their columns are not there.
 */
export async function buildPurchaseReport(
  actor: PurchasingActor,
  input: {
    kind: PurchaseReportKind;
    format: "xlsx" | "csv";
    from?: string;
    to?: string;
  },
): Promise<PurchaseReportFile> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.report.export",
  );
  let rows: Cell[][];
  let extra: Record<string, string> = {};
  if (input.kind === "pendientes") {
    const report = await getPendingReport(actor);
    rows = [
      [
        "Orden",
        "Estado",
        "Proveedor",
        "Se espera",
        "Clave (SKU)",
        "Producto",
        "Pedido",
        "Recibido",
        "Pendiente",
        "En",
        ...(report.costsVisible ? ["Importe pendiente"] : []),
      ],
      ...report.rows.map((row): Cell[] => [
        row.numberText,
        row.statusLabel,
        row.supplierName,
        row.expectedOn ?? "",
        row.sku,
        row.productName,
        row.orderedText,
        row.receivedText ?? "",
        row.pendingQuantity,
        row.unitText,
        ...(report.costsVisible ? [row.pendingAmount ?? ""] : []),
      ]),
    ];
  } else {
    const report = await getPurchasesBySupplier(actor, {
      from: input.from,
      to: input.to,
    });
    if (!report.ok) return report;
    extra = { desde: report.from, hasta: report.to };
    rows = [
      [
        "Proveedor",
        "Recepciones",
        "Órdenes",
        "Productos",
        "Devoluciones",
        ...(report.costsVisible
          ? ["Recibido", "Devuelto", "Neto", "Líneas sin costo"]
          : []),
      ],
      ...report.rows.map((row): Cell[] => [
        row.supplierName,
        String(row.receipts),
        String(row.orders),
        String(row.products),
        String(row.returns),
        ...(report.costsVisible
          ? [
              row.receivedAmount ?? "",
              row.returnedAmount ?? "",
              row.netAmount ?? "",
              String(row.linesWithoutCost ?? 0),
            ]
          : []),
      ]),
    ];
  }
  const kind = PURCHASE_REPORT_KINDS[input.kind];
  const format = input.format === "csv" ? "csv" : "xlsx";
  const bytes =
    format === "csv"
      ? buildCsv(rows)
      : buildXlsx([{ name: kind.sheet, rows, headerRows: 1 }]);
  await recordAuditEvent(forOrganization(actor.organizationId), {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "purchasing.report_exported",
    target: { type: "report", id: input.kind },
    metadata: {
      contenido: kind.label,
      formato: format,
      filas: rows.length - 1,
      ...extra,
    },
  });
  // The day of the company, as the screen counts days.
  const today = dayOf(new Date(), await timeZoneOf(actor.organizationId));
  return {
    ok: true,
    name: `compras-${input.kind}-${today}.${format}`,
    contentType:
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
    rows: rows.length - 1,
  };
}
