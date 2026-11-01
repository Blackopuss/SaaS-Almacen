import "server-only";

import { formatDate } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { PDF_PAGE, PdfPageWriter, buildPdf, wrapText } from "@/platform/files";
import { forOrganization } from "@/server";

import type { SalesActor } from "./prices";
import { getQuote, type QuoteView } from "./quotes";

/**
 * The quote as a PDF (COT-03, like ADR 0019): the paper handed or mailed to
 * the customer, headed with the name of the business, with what is
 * offered, its prices, VAT and total, and until when it holds. It has no
 * costs, so whoever may read quotes may download it. A draft or a quote
 * that is no longer in force says so across its top. It is not a tax
 * receipt.
 */

const MARGIN = 48;
const RIGHT = PDF_PAGE.width - MARGIN;
const BOTTOM = PDF_PAGE.height - 72;
const DETAILS = MARGIN + 320;

const COLUMN = {
  number: MARGIN,
  code: MARGIN + 18,
  description: MARGIN + 96,
  quantity: MARGIN + 252,
  price: RIGHT - 80,
  amount: RIGHT,
} as const;

export type QuotePdf = { name: string; contentType: string; bytes: Buffer };

const day = (value: string) =>
  formatDate(new Date(`${value}T12:00:00.000Z`), "UTC");

/** What crosses the top of a paper that is not a quote in force. */
const MARKS: Partial<Record<QuoteView["status"], string>> = {
  DRAFT: "BORRADOR · todavía no se envía",
  EXPIRED: "VENCIDA",
  REJECTED: "RECHAZADA",
};

function draw(
  quote: QuoteView,
  company: { name: string; timeZone: string },
): PdfPageWriter[] {
  const pages: PdfPageWriter[] = [];
  let page = new PdfPageWriter();
  let y = 0;
  const descriptionWidth = COLUMN.quantity - COLUMN.description - 10;
  const quantityWidth = COLUMN.price - 70 - COLUMN.quantity;
  const numberText = `Cotización ${quote.number}`;

  const tableHeader = () => {
    page.box(MARGIN, y - 10, RIGHT - MARGIN, 16, 0.92);
    const head = { size: 8, font: "bold" as const };
    page.text(COLUMN.number + 2, y, "#", head);
    page.text(COLUMN.code, y, "Clave", head);
    page.text(COLUMN.description, y, "Producto", head);
    page.text(COLUMN.quantity, y, "Cantidad", head);
    page.text(COLUMN.price, y, "Precio", { ...head, align: "right" });
    page.text(COLUMN.amount - 2, y, "Importe", { ...head, align: "right" });
    y += 18;
  };

  const startPage = (first: boolean) => {
    page = new PdfPageWriter();
    pages.push(page);
    page.text(MARGIN, 56, company.name, { size: 15, font: "bold" });
    page.text(RIGHT, 52, "COTIZACIÓN", {
      size: 12,
      font: "bold",
      align: "right",
    });
    page.text(RIGHT, 68, String(quote.number), { size: 12, align: "right" });
    const mark = MARKS[quote.status];
    if (mark) {
      page.text(RIGHT, 82, mark, {
        size: 9,
        font: "bold",
        align: "right",
        gray: 0.35,
      });
    }
    page.line(MARGIN, 92, RIGHT, 92, { width: 1 });
    y = 112;
    if (!first) {
      page.text(MARGIN, y, "Continuación", { size: 9, gray: 0.35 });
      y += 20;
      tableHeader();
    }
  };

  startPage(true);

  const label = { size: 8, gray: 0.35 } as const;
  page.text(MARGIN, y, "CLIENTE", label);
  page.text(DETAILS, y, "DATOS DE LA COTIZACIÓN", label);
  const top = y + 14;
  let left = top;
  for (const line of wrapText(quote.customer.name, 300, 11, "bold").slice(
    0,
    2,
  )) {
    page.text(MARGIN, left, line, { size: 11, font: "bold" });
    left += 14;
  }
  for (const text of [
    quote.customer.rfc ? `RFC ${quote.customer.rfc}` : null,
    quote.customer.phone ? `Tel. ${quote.customer.phone}` : null,
    quote.customer.email,
  ]) {
    if (!text) continue;
    for (const line of wrapText(text, 300, 9, "regular").slice(0, 2)) {
      page.text(MARGIN, left, line, { size: 9 });
      left += 12;
    }
  }
  let right = top;
  for (const [name, value] of [
    ["Fecha", formatDate(quote.createdAt, company.timeZone)],
    ["Vale hasta", day(quote.validUntil)],
    ["Atiende", quote.createdBy],
  ] as const) {
    if (!value) continue;
    page.text(DETAILS, right, `${name}:`, { size: 9, gray: 0.35 });
    page.text(DETAILS + 60, right, value, { size: 9 });
    right += 12;
  }
  y = Math.max(left, right) + 16;

  tableHeader();
  for (const [index, line] of quote.lines.entries()) {
    const name = wrapText(line.productName, descriptionWidth, 9, "regular");
    const quantity = wrapText(line.quantityText, quantityWidth, 9, "regular");
    const code = wrapText(
      line.sku,
      COLUMN.description - COLUMN.code - 8,
      9,
      "regular",
    );
    const rows = Math.max(name.length, quantity.length, code.length);
    const height = rows * 11 + 7;
    if (y + height > BOTTOM) startPage(false);
    const text = { size: 9 } as const;
    page.text(COLUMN.number + 2, y, String(index + 1), text);
    code.forEach((part, at) => page.text(COLUMN.code, y + at * 11, part, text));
    name.forEach((part, at) =>
      page.text(COLUMN.description, y + at * 11, part, text),
    );
    quantity.forEach((part, at) =>
      page.text(COLUMN.quantity, y + at * 11, part, text),
    );
    page.text(COLUMN.price, y, line.unitPrice.replace(/ c\/u$/, ""), {
      ...text,
      align: "right",
    });
    page.text(COLUMN.amount - 2, y, line.amount, { ...text, align: "right" });
    y += height;
    page.line(MARGIN, y - 9, RIGHT, y - 9, { width: 0.3, gray: 0.75 });
  }

  // Totals, right aligned.
  const totals: [string, string, boolean][] = [
    ...(quote.discount
      ? ([
          [`Descuento (${quote.discount.reason})`, quote.discount.text, false],
        ] as [string, string, boolean][])
      : []),
    ["Subtotal", quote.subtotal, false],
    [quote.taxLabel, quote.tax, false],
    ["Total", quote.total, true],
  ];
  if (y + 16 * totals.length + 10 > BOTTOM) startPage(false);
  y += 6;
  for (const [name, value, strong] of totals) {
    const style = strong
      ? ({ size: 11, font: "bold", align: "right" } as const)
      : ({ size: 9, align: "right" } as const);
    page.text(COLUMN.price, y, name, style);
    page.text(COLUMN.amount - 2, y, value, style);
    y += strong ? 16 : 13;
  }

  // The payment plan offered (PAG-03): the calendar in amounts; its dates
  // start the day of the sale.
  if (quote.plan) {
    const plan = quote.plan;
    const rows: [string, string][] = [
      ["Enganche", plan.downPayment],
      [`${plan.months} mensualidades de`, plan.installment],
      ...(plan.lastInstallment
        ? ([["La última", plan.lastInstallment]] as [string, string][])
        : []),
      [`Interés (${plan.interestText})`, plan.interest],
      ["Total a plazos", plan.totalToPay],
    ];
    if (y + 30 + rows.length * 13 > BOTTOM) startPage(false);
    y += 14;
    page.text(MARGIN, y, `PLAN DE PAGOS: A ${plan.months} MESES`, label);
    y += 13;
    for (const [name, value] of rows) {
      page.text(MARGIN, y, name, { size: 9 });
      page.text(COLUMN.amount - 2, y, value, { size: 9, align: "right" });
      y += 13;
    }
    page.text(
      MARGIN,
      y,
      "Las mensualidades vencen cada mes a partir del día de la compra.",
      { size: 8, gray: 0.35 },
    );
    y += 12;
  }

  if (quote.notes) {
    const notes = wrapText(quote.notes, RIGHT - MARGIN, 9, "regular");
    if (y + 30 + notes.length * 12 > BOTTOM) startPage(false);
    y += 14;
    page.text(MARGIN, y, "NOTAS", label);
    y += 13;
    for (const line of notes) {
      if (y > BOTTOM) startPage(false);
      page.text(MARGIN, y, line, { size: 9 });
      y += 12;
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
      `${numberText} · ${company.name} · No es un comprobante fiscal.`,
      { size: 8, gray: 0.35 },
    );
    sheet.text(
      RIGHT,
      PDF_PAGE.height - 38,
      `Página ${index + 1} de ${pages.length}`,
      { size: 8, align: "right", gray: 0.35 },
    );
  });
  return pages;
}

export type ComposedQuotePdf = {
  quote: QuoteView;
  company: { name: string; timeZone: string };
  pdf: QuotePdf;
};

/**
 * The document of a quote, read as the screen reads it. Null when it is
 * not a quote of the company. It writes no audit line: who calls it does
 * (the download here, the mail in `quote-delivery.ts`).
 */
export async function composeQuotePdf(
  actor: SalesActor,
  quoteId: string,
): Promise<ComposedQuotePdf | null> {
  const quote = await getQuote(actor, quoteId);
  if (!quote) return null;
  const membership = await forOrganization(
    actor.organizationId,
  ).membership.findFirst({
    select: { organization: { select: { name: true, timeZone: true } } },
  });
  if (!membership) return null;
  const company = membership.organization;
  const bytes = buildPdf(draw(quote, company), {
    title: `Cotización ${quote.number}`,
  });
  return {
    quote,
    company,
    pdf: {
      name: `cotizacion-${quote.number}.pdf`,
      contentType: "application/pdf",
      bytes,
    },
  };
}

/** The PDF of a quote of the company; each download goes to the trail. */
export async function buildQuotePdf(
  actor: SalesActor,
  quoteId: string,
): Promise<QuotePdf | null> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.quote.read");
  const composed = await composeQuotePdf(actor, quoteId);
  if (!composed) return null;
  await recordAuditEvent(forOrganization(organizationId), {
    organizationId,
    actorUserId: userId,
    action: "sales.quote_exported",
    target: { type: "sales_quote", id: composed.quote.id },
    metadata: {
      cotizacion: String(composed.quote.number),
      cliente: composed.quote.customer.name,
    },
  });
  return composed.pdf;
}
