import "server-only";

import { dec } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

import { companyToday } from "./calendar";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";
import { findOverdue } from "./receivables";
import { reportPeriod } from "./reports";

/**
 * The portfolio of sales on installments (PAG-09, ADR 0030): what is owed
 * today and how much of it is overdue, and — for a period — what was sold
 * on installments, what was collected and what returns took off. Worked out
 * each time from accounts, payments and credits; nothing is stored.
 */

export type PortfolioReport =
  | {
      ok: true;
      from: string;
      to: string;
      /** Today, whatever the period. */
      owed: string;
      openAccounts: number;
      overdue: string;
      overdueAccounts: number;
      /** Accounts born in the period (sales on installments). */
      sold: {
        count: number;
        /** What the goods were sold for, VAT included. */
        total: string;
        downPayments: string;
        interest: string;
      };
      /** Payments to accounts in the period. */
      collected: {
        count: number;
        total: string;
        cash: string;
        card: string;
        transfer: string;
      };
      /** What returns took off accounts in the period. */
      credited: string;
    }
  | { ok: false; error: string };

export async function getPortfolioReport(
  actor: SalesActor,
  range: { from?: string; to?: string } = {},
): Promise<PortfolioReport> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.report.read",
  );
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.receivable.read",
  );
  const period = await reportPeriod(actor.organizationId, range);
  if (!period.ok) return period;
  const client = forOrganization(actor.organizationId);
  const open = { receivable: { status: "OPEN" as const } };
  const inPeriod = { gte: period.start, lt: period.end };
  const [accounts, paidOpen, creditedOpen, born, payments, credits, overdue] =
    await Promise.all([
      client.salesReceivable.aggregate({
        where: { status: "OPEN" },
        _count: { _all: true },
        _sum: { owed: true },
      }),
      client.salesReceivablePayment.aggregate({
        where: open,
        _sum: { amount: true },
      }),
      client.salesReceivableCredit.aggregate({
        where: open,
        _sum: { credited: true },
      }),
      client.salesReceivable.aggregate({
        where: { createdAt: inPeriod },
        _count: { _all: true },
        _sum: { downPayment: true, financed: true, interest: true },
      }),
      client.salesReceivablePayment.groupBy({
        by: ["method"],
        where: { createdAt: inPeriod },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      client.salesReceivableCredit.aggregate({
        where: { createdAt: inPeriod },
        _sum: { credited: true },
      }),
      companyToday(actor.organizationId).then((today) =>
        findOverdue(client, today),
      ),
    ]);
  const sum = (value: { toString(): string } | null | undefined) =>
    dec(value?.toString() ?? 0);
  const byMethod = (method: "CASH" | "CARD" | "TRANSFER") =>
    sum(payments.find((row) => row.method === method)?._sum.amount);
  const collected = payments.reduce(
    (total, row) => total.plus(sum(row._sum.amount)),
    dec(0),
  );
  return {
    ok: true,
    from: period.from,
    to: period.to,
    owed: formatMoney(
      sum(accounts._sum.owed)
        .minus(sum(paidOpen._sum.amount))
        .minus(sum(creditedOpen._sum.credited)),
    ),
    openAccounts: accounts._count._all,
    overdue: formatMoney(
      overdue.reduce((total, row) => total.plus(row.overdue), dec(0)),
    ),
    overdueAccounts: overdue.length,
    sold: {
      count: born._count._all,
      total: formatMoney(
        sum(born._sum.downPayment).plus(sum(born._sum.financed)),
      ),
      downPayments: formatMoney(sum(born._sum.downPayment)),
      interest: formatMoney(sum(born._sum.interest)),
    },
    collected: {
      count: payments.reduce((total, row) => total + row._count._all, 0),
      total: formatMoney(collected),
      cash: formatMoney(byMethod("CASH")),
      card: formatMoney(byMethod("CARD")),
      transfer: formatMoney(byMethod("TRANSFER")),
    },
    credited: formatMoney(sum(credits._sum.credited)),
  };
}
