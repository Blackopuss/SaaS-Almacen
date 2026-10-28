import "server-only";

import { dec } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

import { dayOfDate } from "./calendar";
import { formatPercent } from "./discounts";
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

export type ReceivableView = {
  id: string;
  number: number;
  status: keyof typeof RECEIVABLE_STATUS_LABELS;
  statusLabel: string;
  downPayment: string;
  financed: string;
  /** «sin interés», «10 % de interés». */
  interestText: string;
  interest: string;
  owed: string;
  months: number;
  installments: {
    number: number;
    /** «2026-11-28». */
    dueDay: string;
    /** «28 nov 2026». */
    dueText: string;
    amount: string;
  }[];
};

/** The account of a sale on installments; null when it was cash. */
export async function getReceivableOfSale(
  actor: SalesActor,
  saleId: string,
): Promise<ReceivableView | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.receivable.read",
  );
  const account = await forOrganization(
    actor.organizationId,
  ).salesReceivable.findFirst({
    where: { saleId: String(saleId).slice(0, 36) },
    include: { installments: { orderBy: { number: "asc" } } },
  });
  if (!account) return null;
  const rate = account.interestPercent.toString();
  return {
    id: account.id,
    number: account.number,
    status: account.status,
    statusLabel: RECEIVABLE_STATUS_LABELS[account.status],
    downPayment: formatMoney(account.downPayment.toString()),
    financed: formatMoney(account.financed.toString()),
    interestText: dec(rate).isZero()
      ? "sin interés"
      : `${formatPercent(rate)} de interés`,
    interest: formatMoney(account.interest.toString()),
    owed: formatMoney(account.owed.toString()),
    months: account.months,
    installments: account.installments.map((installment) => ({
      number: installment.number,
      dueDay: dayOfDate(installment.dueDay),
      dueText: formatDueDay(installment.dueDay),
      amount: formatMoney(installment.amount.toString()),
    })),
  };
}
