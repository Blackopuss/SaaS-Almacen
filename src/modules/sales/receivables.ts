import "server-only";

import { dec, formatDateTime, type Decimal } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization, type TenantDb } from "@/server";

import { companyToday, dateOfDay, dayOfDate } from "./calendar";
import { formatPercent } from "./discounts";
import { applyPayments } from "./installment-plan";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";

/**
 * What a customer owes for a sale on installments (PAG-04, ADR 0030): born
 * with the sale when the down payment is charged, with its calendar.
 */

export const RECEIVABLE_STATUS_LABELS = {
  OPEN: "Por cobrar",
  PAID: "Pagada",
  CANCELLED: "Cancelada",
} as const;

const dayText = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** «28 nov 2026» of a `DATE` column. */
export const formatDueDay = (day: Date) => dayText.format(day);

const INSTALLMENT_STATUS_LABELS = {
  PAID: "Pagada",
  PARTIAL: "Abonada en parte",
  DUE: "Por pagar",
  OVERDUE: "Vencida",
} as const;

export type ReceivableView = {
  id: string;
  number: number;
  status: keyof typeof RECEIVABLE_STATUS_LABELS;
  statusLabel: string;
  customer: { id: string; name: string };
  sale: { id: string; number: number };
  downPayment: string;
  financed: string;
  /** «sin interés», «10 % de interés». */
  interestText: string;
  interest: string;
  owed: string;
  paid: string;
  /** What is still owed. */
  balance: string;
  /** What of it is already past its day. */
  overdue: string;
  months: number;
  installments: {
    number: number;
    /** «2026-11-28». */
    dueDay: string;
    /** «28 nov 2026». */
    dueText: string;
    amount: string;
    left: string;
    status: keyof typeof INSTALLMENT_STATUS_LABELS;
    statusLabel: string;
  }[];
  payments: {
    id: string;
    number: number;
    createdAtText: string;
    amount: string;
    method: "CASH" | "CARD" | "TRANSFER";
    reference: string | null;
    by: string | null;
  }[];
};

const METHOD_LABELS = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
} as const;

async function viewOf(
  actor: SalesActor,
  where: { id: string } | { saleId: string },
): Promise<ReceivableView | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.receivable.read",
  );
  const client = forOrganization(actor.organizationId);
  const account = await client.salesReceivable.findFirst({
    where,
    include: {
      organization: { select: { timeZone: true } },
      customer: { select: { id: true, name: true } },
      sale: { select: { id: true, number: true } },
      installments: { orderBy: { number: "asc" } },
      payments: { orderBy: { number: "asc" } },
    },
  });
  if (!account) return null;
  const timeZone = account.organization.timeZone || "America/Mexico_City";
  const today = await companyToday(actor.organizationId);
  const paid = account.payments.reduce(
    (sum, payment) => sum.plus(payment.amount.toString()),
    dec(0),
  );
  const states = applyPayments(
    account.installments.map((installment) => ({
      number: installment.number,
      dueDay: dayOfDate(installment.dueDay),
      amount: installment.amount.toString(),
    })),
    paid,
    today,
  );
  const people = await client.membership.findMany({
    where: {
      userId: {
        in: [...new Set(account.payments.map((p) => p.receivedByUserId))],
      },
    },
    select: { userId: true, user: { select: { name: true } } },
  });
  const rate = account.interestPercent.toString();
  return {
    id: account.id,
    number: account.number,
    status: account.status,
    statusLabel: RECEIVABLE_STATUS_LABELS[account.status],
    customer: account.customer,
    sale: account.sale,
    downPayment: formatMoney(account.downPayment.toString()),
    financed: formatMoney(account.financed.toString()),
    interestText: dec(rate).isZero()
      ? "sin interés"
      : `${formatPercent(rate)} de interés`,
    interest: formatMoney(account.interest.toString()),
    owed: formatMoney(account.owed.toString()),
    paid: formatMoney(paid),
    balance: formatMoney(dec(account.owed.toString()).minus(paid)),
    overdue: formatMoney(
      states
        .filter((state) => state.status === "OVERDUE")
        .reduce((sum, state) => sum.plus(state.left), dec(0)),
    ),
    months: account.months,
    installments: states.map((state, index) => ({
      number: state.number,
      dueDay: state.dueDay,
      dueText: formatDueDay(account.installments[index]!.dueDay),
      amount: formatMoney(state.amount),
      left: formatMoney(state.left),
      status: state.status,
      statusLabel: INSTALLMENT_STATUS_LABELS[state.status],
    })),
    payments: account.payments.map((payment) => ({
      id: payment.id,
      number: payment.number,
      createdAtText: formatDateTime(payment.createdAt, timeZone),
      amount: formatMoney(payment.amount.toString()),
      method: payment.method,
      reference: payment.reference,
      by:
        people.find((person) => person.userId === payment.receivedByUserId)
          ?.user.name ?? null,
    })),
  };
}

/** An account of the company; null when it does not exist. */
export function getReceivable(
  actor: SalesActor,
  receivableId: string,
): Promise<ReceivableView | null> {
  return viewOf(actor, { id: String(receivableId).slice(0, 36) });
}

/** The account of a sale on installments; null when it was cash. */
export function getReceivableOfSale(
  actor: SalesActor,
  saleId: string,
): Promise<ReceivableView | null> {
  return viewOf(actor, { saleId: String(saleId).slice(0, 36) });
}

export const RECEIVABLE_PAGE_SIZE = 25;

export type ReceivableSummary = {
  id: string;
  number: number;
  customer: string;
  statusLabel: string;
  balance: string;
  /** «28 nov 2026»; null when nothing is due. */
  nextDueText: string | null;
  overdue: boolean;
  /** «$500.00» past its day; null when nothing is. */
  overdueAmount: string | null;
  /** «28 sep 2026»: the oldest installment still unpaid and past its day. */
  overdueSinceText: string | null;
};

/** The company client or a transaction of it. */
type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export type OverdueAccount = {
  receivableId: string;
  overdue: Decimal;
  /** The latest installment already past its day. */
  latestDue: number;
};

/**
 * Open accounts behind on their payments (PAG-07), most overdue first.
 * Payments cover the oldest installments first, so an account is behind
 * exactly when what fell due before today passes what was paid, and then
 * its latest installment due is the one unpaid. Derived, never stored.
 */
export async function findOverdue(
  client: Client,
  today: string,
): Promise<OverdueAccount[]> {
  const [due, paid] = await Promise.all([
    client.salesReceivableInstallment.groupBy({
      by: ["receivableId"],
      where: {
        dueDay: { lt: dateOfDay(today) },
        receivable: { status: "OPEN" },
      },
      _sum: { amount: true },
      _max: { number: true },
    }),
    client.salesReceivablePayment.groupBy({
      by: ["receivableId"],
      where: { receivable: { status: "OPEN" } },
      _sum: { amount: true },
    }),
  ]);
  const paidOf = new Map(
    paid.map((row) => [
      row.receivableId,
      dec(row._sum.amount?.toString() ?? 0),
    ]),
  );
  return due
    .flatMap((row) => {
      const overdue = dec(row._sum.amount?.toString() ?? 0).minus(
        paidOf.get(row.receivableId) ?? 0,
      );
      return overdue.greaterThan(0)
        ? [
            {
              receivableId: row.receivableId,
              overdue,
              latestDue: row._max.number ?? 0,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        b.overdue.comparedTo(a.overdue) ||
        (a.receivableId < b.receivableId ? -1 : 1),
    );
}

/**
 * What one open account has past its day, since when and what it owes in
 * all; null when it is up to date (or not open).
 */
export async function overdueOf(
  client: Client,
  receivableId: string,
  today: string,
): Promise<{ overdue: Decimal; since: Date; balance: Decimal } | null> {
  const account = await client.salesReceivable.findFirst({
    where: { id: receivableId, status: "OPEN" },
    select: {
      owed: true,
      installments: {
        orderBy: { number: "asc" },
        select: { number: true, dueDay: true, amount: true },
      },
      payments: { select: { amount: true } },
    },
  });
  if (!account) return null;
  const paid = account.payments.reduce(
    (sum, payment) => sum.plus(payment.amount.toString()),
    dec(0),
  );
  const states = applyPayments(
    account.installments.map((installment) => ({
      number: installment.number,
      dueDay: dayOfDate(installment.dueDay),
      amount: installment.amount.toString(),
    })),
    paid,
    today,
  );
  const first = states.findIndex((state) => state.status === "OVERDUE");
  if (first < 0) return null;
  return {
    overdue: states
      .filter((state) => state.status === "OVERDUE")
      .reduce((sum, state) => sum.plus(state.left), dec(0)),
    since: account.installments[first]!.dueDay,
    balance: dec(account.owed.toString()).minus(paid),
  };
}

/**
 * Accounts of the company: the open ones (or all), newest first; or only
 * those behind on their payments, most overdue first.
 */
export async function listReceivables(
  actor: SalesActor,
  filters: { page?: number; open?: boolean; overdue?: boolean } = {},
): Promise<{
  items: ReceivableSummary[];
  total: number;
  page: number;
  pageCount: number;
}> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.receivable.read",
  );
  const client = forOrganization(actor.organizationId);
  const today = await companyToday(actor.organizationId);
  const behind = filters.overdue
    ? (await findOverdue(client, today)).map((row) => row.receivableId)
    : null;
  const where = behind
    ? { id: { in: behind } }
    : filters.open === false
      ? {}
      : { status: "OPEN" as const };
  const total = behind
    ? behind.length
    : await client.salesReceivable.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / RECEIVABLE_PAGE_SIZE));
  const requested = Number.isInteger(filters.page) ? Number(filters.page) : 1;
  const page = Math.min(Math.max(requested, 1), pageCount);
  const shown = behind?.slice(
    (page - 1) * RECEIVABLE_PAGE_SIZE,
    page * RECEIVABLE_PAGE_SIZE,
  );
  const [found] = await Promise.all([
    client.salesReceivable.findMany({
      where: shown ? { id: { in: shown } } : where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(shown
        ? {}
        : {
            skip: (page - 1) * RECEIVABLE_PAGE_SIZE,
            take: RECEIVABLE_PAGE_SIZE,
          }),
      select: {
        id: true,
        number: true,
        status: true,
        owed: true,
        customer: { select: { name: true } },
        installments: {
          orderBy: { number: "asc" },
          select: { number: true, dueDay: true, amount: true },
        },
        payments: { select: { amount: true } },
      },
    }),
  ]);
  // Most overdue first, as `findOverdue` ordered them.
  const rows = shown
    ? shown.flatMap((id) => found.filter((row) => row.id === id))
    : found;
  return {
    items: rows.map((row) => {
      const paid = row.payments.reduce(
        (sum, payment) => sum.plus(payment.amount.toString()),
        dec(0),
      );
      const states = applyPayments(
        row.installments.map((installment) => ({
          number: installment.number,
          dueDay: dayOfDate(installment.dueDay),
          amount: installment.amount.toString(),
        })),
        paid,
        today,
      );
      const next = states.findIndex((state) => !state.left.isZero());
      const late = states.filter((state) => state.status === "OVERDUE");
      return {
        id: row.id,
        number: row.number,
        customer: row.customer.name,
        statusLabel: RECEIVABLE_STATUS_LABELS[row.status],
        balance: formatMoney(dec(row.owed.toString()).minus(paid)),
        nextDueText:
          next >= 0 ? formatDueDay(row.installments[next]!.dueDay) : null,
        overdue: late.length > 0,
        overdueAmount:
          late.length > 0
            ? formatMoney(
                late.reduce((sum, state) => sum.plus(state.left), dec(0)),
              )
            : null,
        overdueSinceText:
          late.length > 0
            ? formatDueDay(
                row.installments.find((i) => i.number === late[0]!.number)!
                  .dueDay,
              )
            : null,
      };
    }),
    total,
    page,
    pageCount,
  };
}

export type ReceiptView = {
  number: number;
  companyName: string;
  account: { id: string; number: number };
  customer: string;
  createdAtText: string;
  amount: string;
  methodLabel: string;
  reference: string | null;
  received: string | null;
  change: string | null;
  /** What was still owed right after it. */
  balanceAfter: string;
  by: string | null;
};

/** The receipt of a payment to an account; null when it does not exist. */
export async function getReceivablePayment(
  actor: SalesActor,
  paymentId: string,
): Promise<ReceiptView | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.receivable.read",
  );
  const client = forOrganization(actor.organizationId);
  const payment = await client.salesReceivablePayment.findFirst({
    where: { id: String(paymentId).slice(0, 36) },
    include: {
      organization: { select: { name: true, timeZone: true } },
      receivable: {
        select: {
          id: true,
          number: true,
          owed: true,
          customer: { select: { name: true } },
        },
      },
    },
  });
  if (!payment) return null;
  const before = await client.salesReceivablePayment.aggregate({
    where: {
      receivableId: payment.receivableId,
      number: { lte: payment.number },
    },
    _sum: { amount: true },
  });
  const by = await client.membership.findFirst({
    where: { userId: payment.receivedByUserId },
    select: { user: { select: { name: true } } },
  });
  return {
    number: payment.number,
    companyName: payment.organization.name,
    account: { id: payment.receivable.id, number: payment.receivable.number },
    customer: payment.receivable.customer.name,
    createdAtText: formatDateTime(
      payment.createdAt,
      payment.organization.timeZone || "America/Mexico_City",
    ),
    amount: formatMoney(payment.amount.toString()),
    methodLabel: METHOD_LABELS[payment.method],
    reference: payment.reference,
    received: payment.received
      ? formatMoney(payment.received.toString())
      : null,
    change:
      payment.changeGiven && !payment.changeGiven.isZero()
        ? formatMoney(payment.changeGiven.toString())
        : null,
    balanceAfter: formatMoney(
      dec(payment.receivable.owed.toString()).minus(
        before._sum.amount?.toString() ?? 0,
      ),
    ),
    by: by?.user.name ?? null,
  };
}
