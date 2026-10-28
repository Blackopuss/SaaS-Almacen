import "server-only";

import { dec, formatDate } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { PDF_PAGE, PdfPageWriter, buildPdf } from "@/platform/files";
import { forOrganization } from "@/server";

import { companyToday } from "./calendar";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";
import { getReceivable, type ReceivableView } from "./receivables";

/**
 * The statement of account of a customer (PAG-06, ADR 0030): what they owe
 * across their sales on installments, what they paid and what comes next.
 * Read as the screens read it; the PDF is the same, on paper. It is not a
 * tax receipt.
 */

/** Accounts a statement reads at most. */
export const STATEMENT_MAX_ACCOUNTS = 50;

export type CustomerStatement = {
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  };
  /** «28 de octubre de 2026». */
  todayText: string;
  balance: string;
  overdue: string;
  /** Open accounts first, then the paid ones; newest first. */
  accounts: ReceivableView[];
  /** The next installments still owed, across accounts, soonest first. */
  upcoming: {
    accountNumber: number;
    number: number;
    dueText: string;
    left: string;
    overdue: boolean;
  }[];
  /** Payments made, newest first. */
  payments: {
    accountNumber: number;
    number: number;
    createdAtText: string;
    amount: string;
  }[];
};

/** A customer's statement; null when it is not a customer of the company. */
export async function getCustomerStatement(
  actor: SalesActor,
  customerId: string,
): Promise<CustomerStatement | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.receivable.read",
  );
  const client = forOrganization(actor.organizationId);
  const customer = await client.contact.findFirst({
    where: { id: String(customerId).slice(0, 36), isCustomer: true },
    select: { id: true, name: true, email: true, phone: true },
  });
  if (!customer) return null;
  const rows = await client.salesReceivable.findMany({
    where: { customerId: customer.id, status: { not: "CANCELLED" } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    take: STATEMENT_MAX_ACCOUNTS,
    select: { id: true },
  });
  const accounts = (
    await Promise.all(rows.map((row) => getReceivable(actor, row.id)))
  ).flatMap((account) => (account ? [account] : []));
  const money = (text: string) => dec(text.replace(/[$,]/g, ""));
  const sum = (pick: (account: ReceivableView) => string) =>
    formatMoney(
      accounts.reduce(
        (total, account) => total.plus(money(pick(account))),
        dec(0),
      ),
    );
  const upcoming = accounts
    .flatMap((account) =>
      account.installments
        .filter((installment) => installment.status !== "PAID")
        .map((installment) => ({
          accountNumber: account.number,
          number: installment.number,
          dueDay: installment.dueDay,
          dueText: installment.dueText,
          left: installment.left,
          overdue: installment.status === "OVERDUE",
        })),
    )
    .sort((a, b) => (a.dueDay < b.dueDay ? -1 : a.dueDay > b.dueDay ? 1 : 0))
    .slice(0, 12)
    .map((next) => ({
      accountNumber: next.accountNumber,
      number: next.number,
      dueText: next.dueText,
      left: next.left,
      overdue: next.overdue,
    }));
  const payments = accounts
    .flatMap((account) =>
      account.payments.map((payment) => ({
        accountNumber: account.number,
        number: payment.number,
        createdAtText: payment.createdAtText,
        amount: payment.amount,
      })),
    )
    .sort((a, b) => b.number - a.number)
    .slice(0, 20);
  const today = await companyToday(actor.organizationId);
  return {
    customer,
    todayText: formatDate(new Date(`${today}T12:00:00.000Z`), "UTC"),
    balance: sum((account) => account.balance),
    overdue: sum((account) => account.overdue),
    accounts,
    upcoming,
    payments,
  };
}

const MARGIN = 48;
const RIGHT = PDF_PAGE.width - MARGIN;
const BOTTOM = PDF_PAGE.height - 72;

function draw(
  statement: CustomerStatement,
  company: { name: string },
): PdfPageWriter[] {
  const pages: PdfPageWriter[] = [];
  let page = new PdfPageWriter();
  let y = 0;
  const startPage = () => {
    page = new PdfPageWriter();
    pages.push(page);
    page.text(MARGIN, 56, company.name, { size: 15, font: "bold" });
    page.text(RIGHT, 52, "ESTADO DE CUENTA", {
      size: 12,
      font: "bold",
      align: "right",
    });
    page.text(RIGHT, 68, statement.todayText, { size: 10, align: "right" });
    page.line(MARGIN, 92, RIGHT, 92, { width: 1 });
    y = 112;
  };
  const room = (height: number) => {
    if (y + height > BOTTOM) startPage();
  };
  const label = { size: 8, gray: 0.35 } as const;
  const row = (name: string, value: string, strong = false) => {
    room(14);
    const style = strong
      ? ({ size: 10, font: "bold" } as const)
      : ({ size: 9 } as const);
    page.text(MARGIN, y, name, style);
    page.text(RIGHT, y, value, { ...style, align: "right" });
    y += strong ? 15 : 13;
  };

  startPage();
  page.text(MARGIN, y, "CLIENTE", label);
  y += 14;
  page.text(MARGIN, y, statement.customer.name, { size: 11, font: "bold" });
  y += 22;
  row("Saldo", statement.balance, true);
  if (statement.overdue !== "$0.00") row("Vencido", statement.overdue, true);

  for (const account of statement.accounts) {
    room(60);
    y += 10;
    page.text(
      MARGIN,
      y,
      `CUENTA ${account.number} · ${account.statusLabel.toUpperCase()}`,
      label,
    );
    y += 14;
    row(
      `Venta ${account.sale.number}: enganche ${account.downPayment}, ${account.months} mensualidades (${account.interestText})`,
      "",
    );
    row("Total a pagar a plazos", account.owed);
    row("Pagado", account.paid);
    row("Saldo", account.balance, true);
  }

  if (statement.upcoming.length > 0) {
    room(40);
    y += 10;
    page.text(MARGIN, y, "PRÓXIMOS PAGOS", label);
    y += 14;
    for (const next of statement.upcoming) {
      row(
        `Cuenta ${next.accountNumber}, mensualidad ${next.number}: ${next.dueText}${next.overdue ? " (vencida)" : ""}`,
        next.left,
      );
    }
  }
  if (statement.payments.length > 0) {
    room(40);
    y += 10;
    page.text(MARGIN, y, "PAGOS RECIBIDOS", label);
    y += 14;
    for (const payment of statement.payments) {
      row(
        `Recibo ${payment.number} · cuenta ${payment.accountNumber} · ${payment.createdAtText}`,
        payment.amount,
      );
    }
  }

  pages.forEach((sheet, index) => {
    sheet.line(MARGIN, PDF_PAGE.height - 52, RIGHT, PDF_PAGE.height - 52, {
      width: 0.3,
      gray: 0.75,
    });
    sheet.text(
      MARGIN,
      PDF_PAGE.height - 38,
      `Estado de cuenta · ${company.name} · No es un comprobante fiscal.`,
      { size: 8, gray: 0.35 },
    );
    sheet.text(
      RIGHT,
      PDF_PAGE.height - 38,
      `Página ${index + 1} de ${pages.length}`,
      { size: 8, gray: 0.35, align: "right" },
    );
  });
  return pages;
}

export type StatementPdf = { name: string; contentType: string; bytes: Buffer };

/** The statement on paper, read as the screen reads it; no audit line. */
export async function composeStatementPdf(
  actor: SalesActor,
  customerId: string,
): Promise<{
  statement: CustomerStatement;
  company: { name: string };
  pdf: StatementPdf;
} | null> {
  const statement = await getCustomerStatement(actor, customerId);
  if (!statement) return null;
  const membership = await forOrganization(
    actor.organizationId,
  ).membership.findFirst({
    select: { organization: { select: { name: true } } },
  });
  if (!membership) return null;
  const company = membership.organization;
  return {
    statement,
    company,
    pdf: {
      name: "estado-de-cuenta.pdf",
      contentType: "application/pdf",
      bytes: buildPdf(draw(statement, company), {
        title: `Estado de cuenta de ${statement.customer.name}`,
      }),
    },
  };
}

/** The statement PDF of a customer; each download goes to the trail. */
export async function buildStatementPdf(
  actor: SalesActor,
  customerId: string,
): Promise<StatementPdf | null> {
  const composed = await composeStatementPdf(actor, customerId);
  if (!composed) return null;
  await recordAuditEvent(forOrganization(actor.organizationId), {
    organizationId: actor.organizationId,
    actorUserId: actor.userId,
    action: "sales.statement_exported",
    target: { type: "contact", id: composed.statement.customer.id },
    metadata: { cliente: composed.statement.customer.name },
  });
  return composed.pdf;
}
