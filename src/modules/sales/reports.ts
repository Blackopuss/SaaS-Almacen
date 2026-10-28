import "server-only";

import { Decimal, dec } from "@/lib";
import {
  formatStock,
  mayReadInventoryCosts,
  startOfDay,
} from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { buildCsv, buildXlsx, type Cell } from "@/platform/files";
import { forOrganization } from "@/server";

import type { SalesActor } from "./prices";
import { addDays, dayOf, timeZoneOf } from "./calendar";
import { formatMoney } from "./pricing";

/**
 * Reports of Ventas (VEN-23): what was sold in a period, by day, by
 * product and by who charged. Worked out from sales, their lines and
 * their returns each time; nothing is stored. Cancelled sales and returns
 * are already taken off. The profit (before VAT, at the average cost each
 * line left with) exists only for who may see inventory costs: for the
 * rest it is not in the answer nor in the files.
 */

/** Sales a report reads at most (as an export, IMP-11). */
export const SALES_REPORT_MAX = 5_000;

type Money = { amount: string; text: string };
const money = (value: Decimal): Money => {
  const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { amount: rounded.toFixed(2), text: formatMoney(rounded) };
};

export type SalesReportRow = {
  key: string;
  label: string;
  /** Sales that count (not cancelled). */
  sales: number;
  /** What customers paid, VAT included, after returns. */
  total: Money;
  /** Only with inventory costs. */
  profit?: Money;
};

export type ProductReportRow = SalesReportRow & {
  /** With costs visible, but no known cost: no profit to show. */
  costUnknown?: true;
  sku: string;
  /** «12 piezas», after returns. */
  quantity: string;
  /** The same, as a plain number for files. */
  baseQuantity: string;
};

export type SalesReport =
  | {
      ok: true;
      from: string;
      to: string;
      costsVisible: boolean;
      sales: number;
      total: Money;
      profit?: Money;
      /** Lines without a known cost: their profit is not counted. */
      linesWithoutCost?: number;
      byDay: SalesReportRow[];
      byProduct: ProductReportRow[];
      byCashier: SalesReportRow[];
      /** More sales than the report reads: totals are incomplete. */
      truncated: boolean;
    }
  | { ok: false; error: string };

export type ReportPeriod =
  | {
      ok: true;
      /** «2026-10-01». */
      from: string;
      to: string;
      start: Date;
      /** The first moment after the last day. */
      end: Date;
    }
  | { ok: false; error: string };

/**
 * Two days of the company's calendar, both included (by default, this
 * month), as the moments a query reads between.
 */
export async function reportPeriod(
  organizationId: string,
  range: { from?: string; to?: string },
): Promise<ReportPeriod> {
  const timeZone = await timeZoneOf(organizationId);
  const today = dayOf(new Date(), timeZone);
  const fromDay = range.from?.trim() || `${today.slice(0, 8)}01`;
  const toDay = range.to?.trim() || today;
  const start = startOfDay(fromDay, timeZone);
  const end = startOfDay(addDays(toDay, 1), timeZone);
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
  return { ok: true, from: fromDay, to: toDay, start, end };
}

type Acc = {
  label: string;
  sales: Set<string>;
  total: Decimal;
  profit: Decimal;
  /** Lines sold without a known cost. */
  withoutCost: number;
};
const fresh = (label: string): Acc => ({
  label,
  sales: new Set(),
  total: dec(0),
  profit: dec(0),
  withoutCost: 0,
});

/**
 * Sales between two days of the company's calendar (by default, this
 * month), both included.
 */
export async function getSalesReport(
  actor: SalesActor,
  range: { from?: string; to?: string } = {},
): Promise<SalesReport> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.report.read",
  );
  const costsVisible = await mayReadInventoryCosts(actor);
  const timeZone = await timeZoneOf(actor.organizationId);
  const period = await reportPeriod(actor.organizationId, range);
  if (!period.ok) return period;
  const { from: fromDay, to: toDay, start, end } = period;

  const client = forOrganization(actor.organizationId);
  const rows = await client.sale.findMany({
    where: { createdAt: { gte: start, lt: end }, status: "COMPLETED" },
    orderBy: { number: "asc" },
    take: SALES_REPORT_MAX + 1,
    select: {
      id: true,
      createdAt: true,
      soldByUserId: true,
      pricesIncludeTax: true,
      taxRate: true,
      total: true,
      // On installments, what came back is its goods, not the money (PAG-08).
      returns: {
        select: {
          refund: true,
          accountCredit: { select: { goodsValue: true } },
        },
      },
      lines: {
        select: {
          productId: true,
          unitCode: true,
          baseQuantity: true,
          amount: true,
          ...(costsVisible ? { unitCost: true } : {}),
          product: { select: { name: true, sku: true } },
          returnLines: { select: { baseQuantity: true, refund: true } },
        },
      },
    },
  });
  const truncated = rows.length > SALES_REPORT_MAX;
  const sales = rows.slice(0, SALES_REPORT_MAX);

  const members = await client.membership.findMany({
    where: { userId: { in: [...new Set(sales.map((s) => s.soldByUserId))] } },
    select: { userId: true, user: { select: { name: true } } },
  });
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name]));

  const days = new Map<string, Acc>();
  const cashiers = new Map<string, Acc>();
  const products = new Map<
    string,
    Acc & { sku: string; unitCode: string; quantity: Decimal }
  >();
  let total = dec(0);
  let profit = dec(0);
  let withoutCost = 0;

  for (const sale of sales) {
    const day = dayOf(sale.createdAt, timeZone);
    const dayAcc = days.get(day) ?? fresh(day);
    days.set(day, dayAcc);
    const cashierAcc =
      cashiers.get(sale.soldByUserId) ??
      fresh(nameOf.get(sale.soldByUserId) ?? "Alguien que ya no está");
    cashiers.set(sale.soldByUserId, cashierAcc);

    const rate = dec(sale.taxRate.toString()).dividedBy(100);
    // What the customer paid for the whole sale, after its returns.
    const net = sale.returns.reduce(
      (sum, r) =>
        sum.minus((r.accountCredit?.goodsValue ?? r.refund).toString()),
      dec(sale.total.toString()),
    );
    let saleProfit = dec(0);
    for (const line of sale.lines) {
      const returned = line.returnLines.reduce(
        (sum, r) => ({
          base: sum.base.plus(r.baseQuantity.toString()),
          refund: sum.refund.plus(r.refund.toString()),
        }),
        { base: dec(0), refund: dec(0) },
      );
      const base = dec(line.baseQuantity.toString()).minus(returned.base);
      // The line as it stays: before VAT when VAT is added on top.
      const amount = dec(line.amount.toString()).minus(returned.refund);
      const paid = sale.pricesIncludeTax
        ? amount
        : amount.plus(
            amount.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
          );
      const beforeTax = sale.pricesIncludeTax
        ? amount.dividedBy(rate.plus(1))
        : amount;
      const cost = (line as { unitCost?: { toString(): string } | null })
        .unitCost;
      let lineProfit = dec(0);
      const unknown = costsVisible && !cost && base.greaterThan(0);
      if (costsVisible && cost) {
        lineProfit = beforeTax.minus(base.times(cost.toString()));
      } else if (unknown) {
        withoutCost += 1;
      }
      saleProfit = saleProfit.plus(lineProfit);

      const productAcc = products.get(line.productId) ?? {
        ...fresh(line.product.name),
        sku: line.product.sku,
        unitCode: line.unitCode,
        quantity: dec(0),
      };
      products.set(line.productId, productAcc);
      if (base.greaterThan(0)) productAcc.sales.add(sale.id);
      productAcc.quantity = productAcc.quantity.plus(base);
      productAcc.total = productAcc.total.plus(paid);
      productAcc.profit = productAcc.profit.plus(lineProfit);
      if (unknown) productAcc.withoutCost += 1;
    }
    for (const acc of [dayAcc, cashierAcc]) {
      acc.sales.add(sale.id);
      acc.total = acc.total.plus(net);
      acc.profit = acc.profit.plus(saleProfit);
    }
    total = total.plus(net);
    profit = profit.plus(saleProfit);
  }

  const row = (
    key: string,
    acc: Acc,
    withProfit = costsVisible,
  ): SalesReportRow => ({
    key,
    label: acc.label,
    sales: acc.sales.size,
    total: money(acc.total),
    ...(withProfit ? { profit: money(acc.profit) } : {}),
  });
  const byTotal = (a: { total: Money }, b: { total: Money }) =>
    dec(b.total.amount).comparedTo(a.total.amount);

  return {
    ok: true,
    from: fromDay,
    to: toDay,
    costsVisible,
    sales: sales.length,
    total: money(total),
    ...(costsVisible
      ? { profit: money(profit), linesWithoutCost: withoutCost }
      : {}),
    byDay: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, acc]) => row(key, acc)),
    byProduct: [...products.entries()]
      .map(([key, acc]): ProductReportRow => {
        // A product sold without a known cost has no profit to show.
        const unknown = costsVisible && acc.withoutCost > 0;
        return {
          ...row(key, acc, costsVisible && !unknown),
          ...(unknown ? { costUnknown: true as const } : {}),
          sku: acc.sku,
          quantity: formatStock(acc.quantity.toString(), acc.unitCode),
          baseQuantity: acc.quantity.toString(),
        };
      })
      .sort((a, b) => byTotal(a, b) || a.label.localeCompare(b.label, "es-MX")),
    byCashier: [...cashiers.entries()]
      .map(([key, acc]) => row(key, acc))
      .sort((a, b) => byTotal(a, b) || a.label.localeCompare(b.label, "es-MX")),
    truncated,
  };
}

export const SALES_REPORT_KINDS = {
  dias: { label: "Ventas por día", sheet: "Por día" },
  productos: { label: "Ventas por producto", sheet: "Por producto" },
  cajeros: { label: "Ventas por quién cobró", sheet: "Por quién cobró" },
} as const;

export type SalesReportKind = keyof typeof SALES_REPORT_KINDS;

export const isSalesReportKind = (value: unknown): value is SalesReportKind =>
  typeof value === "string" && Object.hasOwn(SALES_REPORT_KINDS, value);

export type SalesReportFile =
  | { ok: true; name: string; contentType: string; bytes: Buffer; rows: number }
  | { ok: false; error: string };

/**
 * A report as a file (VEN-23). Needs `sales.report.export` and reads
 * through the same service as the screen, so the file never holds more
 * than the screen shows: without costs, the profit column is not there.
 */
export async function buildSalesReport(
  actor: SalesActor,
  input: {
    kind: SalesReportKind;
    format: "xlsx" | "csv";
    from?: string;
    to?: string;
  },
): Promise<SalesReportFile> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.report.export",
  );
  const report = await getSalesReport(actor, {
    from: input.from,
    to: input.to,
  });
  if (!report.ok) return report;
  const profitHead = report.costsVisible ? ["Ganancia antes de IVA"] : [];
  const profitOf = (row: SalesReportRow): Cell[] =>
    report.costsVisible ? [row.profit?.amount ?? ""] : [];
  let rows: Cell[][];
  if (input.kind === "dias") {
    rows = [
      ["Día", "Ventas", "Total con IVA", ...profitHead],
      ...report.byDay.map((row): Cell[] => [
        row.label,
        String(row.sales),
        row.total.amount,
        ...profitOf(row),
      ]),
    ];
  } else if (input.kind === "productos") {
    rows = [
      [
        "Clave (SKU)",
        "Producto",
        "Cantidad",
        "Ventas",
        "Total con IVA",
        ...profitHead,
      ],
      ...report.byProduct.map((row): Cell[] => [
        row.sku,
        row.label,
        row.baseQuantity,
        String(row.sales),
        row.total.amount,
        ...profitOf(row),
      ]),
    ];
  } else {
    rows = [
      ["Quién cobró", "Ventas", "Total con IVA", ...profitHead],
      ...report.byCashier.map((row): Cell[] => [
        row.label,
        String(row.sales),
        row.total.amount,
        ...profitOf(row),
      ]),
    ];
  }
  const kind = SALES_REPORT_KINDS[input.kind];
  const format = input.format === "csv" ? "csv" : "xlsx";
  const bytes =
    format === "csv"
      ? buildCsv(rows)
      : buildXlsx([{ name: kind.sheet, rows, headerRows: 1 }]);
  await recordAuditEvent(forOrganization(actor.organizationId), {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "sales.report_exported",
    target: { type: "report", id: input.kind },
    metadata: {
      contenido: kind.label,
      formato: format,
      filas: rows.length - 1,
      desde: report.from,
      hasta: report.to,
    },
  });
  return {
    ok: true,
    name: `ventas-${input.kind}-${report.from}-a-${report.to}.${format}`,
    contentType:
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes,
    rows: rows.length - 1,
  };
}
