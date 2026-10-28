import "server-only";

import { dec } from "@/lib";
import { startOfDay } from "@/modules/inventory";
import { assertModulePermission } from "@/platform/billing";
import { normalizeSearch } from "@/platform/catalog";
import { forOrganization } from "@/server";

import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "./payments";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";

/**
 * History of sales (VEN-22): newest first, one page at a time, filtered by
 * days of the company's calendar, who charged and the customer (or the
 * sale's number). What it shows is what the ticket says.
 */

export const SALE_PAGE_SIZE = 25;

export type SaleFilters = {
  /** First and last day, as dates of the company's calendar: "2026-10-05". */
  from?: string;
  to?: string;
  /** Who charged it. */
  cashierId?: string;
  /** A sale's number, or words of the customer's name. */
  search?: string;
  page?: number;
};

export type SaleSummary = {
  id: string;
  number: number;
  createdAt: Date;
  /** «Público en general» when it has none. */
  customer: string;
  cashier: string | null;
  total: string;
  /** «Efectivo», «Efectivo y tarjeta». */
  paidWith: string;
  cancelled: boolean;
  /** Given back by returns, when there were some and it is not cancelled. */
  refunded: string | null;
};

export type SalePage = {
  items: SaleSummary[];
  total: number;
  page: number;
  pageCount: number;
  /** The filters as they were understood; what could not be read is dropped. */
  applied: {
    from: string | null;
    to: string | null;
    cashierId: string | null;
    search: string | null;
  };
};

/** Text as it is for LIKE: its wildcards are ordinary characters. */
const literal = (term: string) => term.replace(/[\\%_]/g, "\\$&");

function listOf(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} y ${words.at(-1)!.toLowerCase()}`;
}

export async function listSales(
  actor: SalesActor,
  filters: SaleFilters = {},
): Promise<SalePage> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.read",
  );
  const client = forOrganization(actor.organizationId);
  const organization = await client.membership.findFirst({
    select: { organization: { select: { timeZone: true } } },
  });
  const timeZone = organization?.organization.timeZone ?? "America/Mexico_City";
  const from = startOfDay(filters.from, timeZone);
  const toStart = startOfDay(filters.to, timeZone);
  // The last day is included whole: up to the start of the next one.
  const until = toStart
    ? new Date(toStart.getTime() + 24 * 60 * 60 * 1000)
    : null;
  const cashierId = filters.cashierId
    ? String(filters.cashierId).slice(0, 36)
    : null;
  const search = normalizeSearch(filters.search) || null;
  const number =
    search && /^\d{1,9}$/.test(search) ? Number.parseInt(search, 10) : null;
  const words = search && number === null ? search.split(" ").slice(0, 6) : [];

  const where = {
    ...(from || until
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(until ? { lt: until } : {}),
          },
        }
      : {}),
    ...(cashierId ? { soldByUserId: cashierId } : {}),
    ...(number !== null ? { number } : {}),
    ...(words.length > 0
      ? {
          customer: {
            AND: words.map((word) => ({
              name: { contains: literal(word) },
            })),
          },
        }
      : {}),
  };

  const total = await client.sale.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / SALE_PAGE_SIZE));
  const requested = Number.isInteger(filters.page) ? Number(filters.page) : 1;
  const page = Math.min(Math.max(requested, 1), pageCount);
  const rows = await client.sale.findMany({
    where,
    orderBy: { number: "desc" },
    skip: (page - 1) * SALE_PAGE_SIZE,
    take: SALE_PAGE_SIZE,
    select: {
      id: true,
      number: true,
      createdAt: true,
      status: true,
      total: true,
      soldByUserId: true,
      customer: { select: { name: true } },
      payments: { orderBy: { lineNumber: "asc" }, select: { method: true } },
      // On installments, what came back is its goods, not the money (PAG-08).
      returns: {
        select: {
          refund: true,
          accountCredit: { select: { goodsValue: true } },
        },
      },
    },
  });
  // Names come from the memberships of this company only.
  const members = await client.membership.findMany({
    where: { userId: { in: [...new Set(rows.map((r) => r.soldByUserId))] } },
    select: { userId: true, user: { select: { name: true } } },
  });
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name]));

  return {
    items: rows.map((row) => {
      const refunded = row.returns.reduce(
        (sum, r) =>
          sum.plus((r.accountCredit?.goodsValue ?? r.refund).toString()),
        dec(0),
      );
      const methods = [
        ...new Set(row.payments.map((p) => p.method as PaymentMethod)),
      ];
      return {
        id: row.id,
        number: row.number,
        createdAt: row.createdAt,
        customer: row.customer?.name ?? "Público en general",
        cashier: nameOf.get(row.soldByUserId) ?? null,
        total: formatMoney(row.total.toString()),
        paidWith: listOf(methods.map((m) => PAYMENT_METHOD_LABELS[m])),
        cancelled: row.status === "CANCELLED",
        refunded:
          row.status !== "CANCELLED" && refunded.greaterThan(0)
            ? formatMoney(refunded)
            : null,
      };
    }),
    total,
    page,
    pageCount,
    applied: {
      from: from ? filters.from! : null,
      to: toStart ? filters.to! : null,
      cashierId,
      search,
    },
  };
}

/** People who have charged sales in the company, for the filter. */
export async function listSaleCashiers(
  actor: SalesActor,
): Promise<{ userId: string; name: string }[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.read",
  );
  const client = forOrganization(actor.organizationId);
  const sellers = await client.sale.groupBy({
    by: ["soldByUserId"],
    orderBy: { soldByUserId: "asc" },
    take: 500,
  });
  if (sellers.length === 0) return [];
  const members = await client.membership.findMany({
    where: { userId: { in: sellers.map((s) => s.soldByUserId) } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return members
    .map((member) => ({ userId: member.userId, name: member.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es-MX"));
}
