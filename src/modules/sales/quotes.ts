import "server-only";

import { dec, formatDateTime, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { loadSubject } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import { addDays, companyToday, dateOfDay, dayOfDate, isDay } from "./calendar";
import { SALE_MAX_LINES, priceLines, type CartLineInput } from "./cart";
import { quantityText } from "./line-text";
import { PERCENT_ERROR, formatPercent, parsePercent } from "./discounts";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";
import { checkDiscount } from "./sale-discount";
import { readTaxRule } from "./settings";
import { formatTaxRate, saleTotals } from "./tax";

/**
 * Quotes (COT-02, ADR 0030): what a customer would pay, with the prices of
 * the moment — by presentation, with VAT as the company has it and an
 * optional discount within the cap of who quotes — valid up to a day.
 * Nothing leaves stock and no register is needed. While it is a draft it
 * can be changed, and each change prices it again.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export const QUOTE_MAX_LINES = SALE_MAX_LINES;
/** Validity a quote gets when none is written. */
export const QUOTE_DEFAULT_DAYS = 15;
/** The furthest a quote may hold. */
export const QUOTE_MAX_DAYS = 365;

export type QuoteStatus =
  "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
};

export type QuoteInput = {
  customerId: string;
  /** «2026-11-12»; empty = today + 15 days. */
  validUntil?: string;
  notes?: string;
  lines: readonly CartLineInput[];
  /** Discount of the whole quote, as typed: «10», with its reason. */
  discount?: { percent?: string; reason?: string };
};

export type QuoteField =
  | "customerId"
  | "validUntil"
  | "notes"
  | "discountPercent"
  | "discountReason"
  | "lines";

export type QuoteResult =
  | { ok: true; quoteId: string; number: number }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_draft";
      fieldErrors: Partial<Record<QuoteField, string>>;
      /** By position of the line sent. */
      lineErrors: Record<number, string>;
      formError?: string;
    };

type Failure = Extract<QuoteResult, { ok: false }>;
const failure = (patch: Partial<Failure>): Failure => ({
  ok: false,
  reason: "invalid",
  fieldErrors: {},
  lineErrors: {},
  ...patch,
});

class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("quote rejected");
  }
}

const NO_CONTROL = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

/** What a quote holds, read and checked; prices come later, in the transaction. */
async function readInput(
  actor: SalesActor,
  input: QuoteInput,
): Promise<
  | {
      ok: true;
      customerId: string;
      validUntil: string;
      notes: string | null;
      lines: CartLineInput[];
      percent: string | null;
      reason: string | null;
    }
  | { ok: false; failure: Failure }
> {
  const fieldErrors: Failure["fieldErrors"] = {};
  const customerId = String(input.customerId ?? "").slice(0, 36);
  if (customerId === "") fieldErrors.customerId = "Elige a qué cliente va.";

  const today = await companyToday(actor.organizationId);
  const typedDay = String(input.validUntil ?? "").trim();
  const validUntil =
    typedDay === "" ? addDays(today, QUOTE_DEFAULT_DAYS) : typedDay;
  if (!isDay(validUntil)) {
    fieldErrors.validUntil = "Escribe la fecha como día de calendario.";
  } else if (validUntil < today) {
    fieldErrors.validUntil = "La vigencia no puede ser antes de hoy.";
  } else if (validUntil > addDays(today, QUOTE_MAX_DAYS)) {
    fieldErrors.validUntil = "La vigencia puede ser de hasta un año.";
  }

  const notes = String(input.notes ?? "").trim();
  if (notes.length > 1000 || !NO_CONTROL.test(notes)) {
    fieldErrors.notes = "Las notas pueden tener hasta 1,000 caracteres.";
  }

  const typedPercent = String(input.discount?.percent ?? "").trim();
  const percent = typedPercent === "" ? null : parsePercent(typedPercent);
  const reason = String(input.discount?.reason ?? "").trim();
  if (typedPercent !== "" && percent === null) {
    fieldErrors.discountPercent = PERCENT_ERROR;
  }
  const discounted = percent !== null && dec(percent).greaterThan(0);
  if (
    discounted &&
    (reason.length < 3 || reason.length > 200 || !NO_CONTROL.test(reason))
  ) {
    fieldErrors.discountReason = "Escribe por qué (de 3 a 200 caracteres).";
  }

  const lines = (Array.isArray(input.lines) ? input.lines : []).map((line) => ({
    productId: String(line?.productId ?? "").slice(0, 36),
    capture: String(line?.capture ?? "base").slice(0, 40),
    quantity: String(line?.quantity ?? "").slice(0, 40),
  }));
  if (lines.length === 0) {
    fieldErrors.lines = "Agrega al menos un producto.";
  } else if (lines.length > QUOTE_MAX_LINES) {
    fieldErrors.lines = `Una cotización admite hasta ${QUOTE_MAX_LINES} líneas.`;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, failure: failure({ fieldErrors }) };
  }
  return {
    ok: true,
    customerId,
    validUntil,
    notes: notes === "" ? null : notes,
    lines,
    percent: discounted ? percent : null,
    reason: discounted ? reason : null,
  };
}

/**
 * Prices the lines with the prices in force and the discount within the
 * cap of who quotes. Throws `Rejected` with what is wrong.
 */
async function priceQuote(
  tx: Tx,
  actor: SalesActor,
  read: Extract<Awaited<ReturnType<typeof readInput>>, { ok: true }>,
) {
  const customer = await tx.contact.findFirst({
    where: { id: read.customerId, isCustomer: true, archivedAt: null },
    select: { id: true },
  });
  if (!customer) {
    throw new Rejected(
      failure({ fieldErrors: { customerId: "Ese cliente ya no existe." } }),
    );
  }
  const { priced, lineErrors } = await priceLines(tx, read.lines);
  if (Object.keys(lineErrors).length > 0) {
    throw new Rejected(failure({ lineErrors }));
  }
  const lines = priced.flatMap((line) => (line ? [line] : []));
  let discounts = lines.map(() => dec(0));
  if (read.percent) {
    const check = await checkDiscount(tx, {
      organizationId: actor.organizationId,
      seller: await loadSubject(actor.organizationId, actor.userId),
      percent: read.percent,
      lines,
    });
    if (check.needsAuthorization) {
      throw new Rejected(
        failure({
          fieldErrors: {
            discountPercent: `Tu tope de descuento es ${check.cap}. Para dar más, pide a alguien con un tope mayor que haga la cotización.`,
          },
        }),
      );
    }
    if (check.belowCost && !check.mayGoBelowCost) {
      throw new Rejected(
        failure({
          fieldErrors: {
            discountPercent:
              "Con ese descuento algún producto queda por debajo de su costo.",
          },
        }),
      );
    }
    discounts = check.discounts;
  }
  const rule = await readTaxRule(tx, actor.organizationId);
  return {
    rule,
    rows: lines.map((line, index) => ({
      id: newId(),
      organizationId: actor.organizationId,
      lineNumber: index + 1,
      productId: line.productId,
      capturedQuantity: line.capturedQuantity.toString(),
      presentationId: line.presentationId,
      presentationVersionId: line.presentationVersionId,
      factor: line.factor.toString(),
      baseQuantity: line.baseQuantity.toString(),
      unitCode: line.unitCode,
      unitPrice: line.unitPrice.toFixed(2),
      discount: discounts[index]!.toFixed(2),
      amount: line.amount.minus(discounts[index]!).toFixed(2),
    })),
  };
}

/** Writes a new draft quote (COT-02). */
export async function createQuote(
  actor: SalesActor,
  input: QuoteInput,
  attempt = 0,
): Promise<QuoteResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.quote.create",
  );
  const read = await readInput(actor, input);
  if (!read.ok) return read.failure;
  const { organizationId, userId } = actor;
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      const { rule, rows } = await priceQuote(tx, actor, read);
      const last = await tx.salesQuote.findFirst({
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;
      const quoteId = newId();
      await tx.salesQuote.create({
        data: {
          id: quoteId,
          organizationId,
          number,
          customerId: read.customerId,
          validUntil: dateOfDay(read.validUntil),
          pricesIncludeTax: rule.pricesIncludeTax,
          taxRate: rule.rate,
          discountPercent: read.percent ?? "0",
          discountReason: read.reason,
          notes: read.notes,
          createdByUserId: userId,
        },
      });
      await tx.salesQuoteLine.createMany({
        data: rows.map((row) => ({ ...row, quoteId })),
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "sales.quote_created",
        target: { type: "sales_quote", id: quoteId },
        metadata: { cotizacion: String(number) },
      });
      return { ok: true as const, quoteId, number };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    // Two quotes took the same next number: the second reads it again.
    if ((error as { code?: string }).code === "P2002" && attempt < 3) {
      return createQuote(actor, input, attempt + 1);
    }
    throw error;
  }
}

/**
 * Changes a draft (COT-02): customer, validity, notes, discount and lines,
 * priced again with the prices and the VAT in force.
 */
export async function updateQuote(
  actor: SalesActor,
  quoteId: string,
  input: QuoteInput,
): Promise<QuoteResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.quote.create",
  );
  const read = await readInput(actor, input);
  if (!read.ok) return read.failure;
  const { organizationId, userId } = actor;
  const id = String(quoteId).slice(0, 36);
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      const [locked] = await lockRows(tx, "salesQuote", [id]);
      const quote = locked
        ? await tx.salesQuote.findFirst({
            where: { id: locked },
            select: { id: true, number: true, status: true },
          })
        : null;
      if (!quote) {
        throw new Rejected(
          failure({
            reason: "not_found",
            formError: "Esa cotización no existe.",
          }),
        );
      }
      if (quote.status !== "DRAFT") {
        throw new Rejected(
          failure({
            reason: "not_draft",
            formError: "Esta cotización ya se envió: ya no se puede cambiar.",
          }),
        );
      }
      const { rule, rows } = await priceQuote(tx, actor, read);
      await tx.salesQuoteLine.deleteMany({ where: { quoteId: quote.id } });
      await tx.salesQuote.update({
        where: { id: quote.id },
        data: {
          customerId: read.customerId,
          validUntil: dateOfDay(read.validUntil),
          pricesIncludeTax: rule.pricesIncludeTax,
          taxRate: rule.rate,
          discountPercent: read.percent ?? "0",
          discountReason: read.reason,
          notes: read.notes,
        },
      });
      await tx.salesQuoteLine.createMany({
        data: rows.map((row) => ({ ...row, quoteId: quote.id })),
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "sales.quote_updated",
        target: { type: "sales_quote", id: quote.id },
        metadata: { cotizacion: String(quote.number) },
      });
      return { ok: true as const, quoteId: quote.id, number: quote.number };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

/** A sent quote whose last day passed is expired; nothing stores that. */
function statusOf(
  status: string,
  validUntil: Date,
  today: string,
): QuoteStatus {
  if (status === "SENT" && dayOfDate(validUntil) < today) return "EXPIRED";
  return status as QuoteStatus;
}

export type QuoteView = {
  id: string;
  number: number;
  status: QuoteStatus;
  statusLabel: string;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    rfc: string | null;
    email: string | null;
  };
  /** «2026-11-12». */
  validUntil: string;
  notes: string | null;
  createdBy: string | null;
  createdAt: Date;
  /** «12 oct 2026, 10:15 a.m.», in the company's time zone. */
  createdAtText: string;
  /** When it was sent, and the customer's answer (COT-04). */
  sentAtText: string | null;
  decision: {
    atText: string;
    /** Who recorded it. */
    by: string | null;
    rejectReason: string | null;
  } | null;
  /** The order it became (COT-05). */
  order: { id: string; number: number } | null;
  lines: {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    /** "base" or "p:<presentation id>", to edit it. */
    capture: string;
    /** As captured: «2», «2.75». */
    quantity: string;
    /** «2 cajas de 500 piezas», «2.75 metros». */
    quantityText: string;
    unitPrice: string;
    /** Before the discount. */
    amount: string;
  }[];
  /** «-$50.45 (10 %)», with its reason. */
  discount: { text: string; percent: string; reason: string } | null;
  subtotal: string;
  taxLabel: string;
  tax: string;
  total: string;
};

/** A quote of the company with its totals; null when it does not exist. */
export async function getQuote(
  actor: SalesActor,
  quoteId: string,
): Promise<QuoteView | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.quote.read",
  );
  const client = forOrganization(actor.organizationId);
  const quote = await client.salesQuote.findFirst({
    where: { id: String(quoteId).slice(0, 36) },
    include: {
      organization: { select: { timeZone: true } },
      order: { select: { id: true, number: true } },
      customer: {
        select: { id: true, name: true, phone: true, rfc: true, email: true },
      },
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          product: { select: { name: true, sku: true } },
          presentation: { select: { name: true } },
        },
      },
    },
  });
  if (!quote) return null;
  const people = await client.membership.findMany({
    where: {
      userId: {
        in: [quote.createdByUserId, quote.decidedByUserId ?? ""].filter(
          Boolean,
        ),
      },
    },
    select: { userId: true, user: { select: { name: true } } },
  });
  const nameOf = (userId: string | null) =>
    people.find((person) => person.userId === userId)?.user.name ?? null;
  const timeZone = quote.organization.timeZone || "America/Mexico_City";
  const today = await companyToday(actor.organizationId);
  const status = statusOf(quote.status, quote.validUntil, today);
  const totals = saleTotals(
    quote.lines.map((line) => line.amount.toString()),
    {
      pricesIncludeTax: quote.pricesIncludeTax,
      rate: quote.taxRate.toString(),
    },
  );
  const off = quote.lines.reduce(
    (sum, line) => sum.plus(line.discount.toString()),
    dec(0),
  );
  const rate = formatTaxRate(quote.taxRate.toString());
  return {
    id: quote.id,
    number: quote.number,
    status,
    statusLabel: QUOTE_STATUS_LABELS[status],
    customer: quote.customer,
    validUntil: dayOfDate(quote.validUntil),
    notes: quote.notes,
    createdBy: nameOf(quote.createdByUserId),
    createdAt: quote.createdAt,
    createdAtText: formatDateTime(quote.createdAt, timeZone),
    sentAtText: quote.sentAt ? formatDateTime(quote.sentAt, timeZone) : null,
    decision: quote.decidedAt
      ? {
          atText: formatDateTime(quote.decidedAt, timeZone),
          by: nameOf(quote.decidedByUserId),
          rejectReason: quote.rejectReason,
        }
      : null,
    order: quote.order,
    lines: quote.lines.map((line) => {
      const captured = dec(line.capturedQuantity.toString());
      return {
        id: line.id,
        productId: line.productId,
        productName: line.product.name,
        sku: line.product.sku,
        capture: line.presentationId ? `p:${line.presentationId}` : "base",
        quantity: captured.toString(),
        quantityText: quantityText(line),
        unitPrice: `${formatMoney(line.unitPrice.toString())} c/u`,
        amount: formatMoney(
          dec(line.amount.toString()).plus(line.discount.toString()),
        ),
      };
    }),
    discount: off.isZero()
      ? null
      : {
          text: `-${formatMoney(off)} (${formatPercent(quote.discountPercent.toString())})`,
          percent: dec(quote.discountPercent.toString()).toString(),
          reason: quote.discountReason ?? "",
        },
    subtotal: formatMoney(totals.subtotal),
    taxLabel: quote.pricesIncludeTax
      ? `IVA incluido (${rate})`
      : `IVA (${rate})`,
    tax: formatMoney(totals.tax),
    total: formatMoney(totals.total),
  };
}

export const QUOTE_PAGE_SIZE = 25;

export type QuoteSummary = {
  id: string;
  number: number;
  customer: string;
  status: QuoteStatus;
  statusLabel: string;
  validUntil: string;
  total: string;
};

/** Quotes of the company, newest first, one page at a time. */
export async function listQuotes(
  actor: SalesActor,
  filters: { page?: number } = {},
): Promise<{
  items: QuoteSummary[];
  total: number;
  page: number;
  pageCount: number;
}> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.quote.read",
  );
  const client = forOrganization(actor.organizationId);
  const total = await client.salesQuote.count();
  const pageCount = Math.max(1, Math.ceil(total / QUOTE_PAGE_SIZE));
  const requested = Number.isInteger(filters.page) ? Number(filters.page) : 1;
  const page = Math.min(Math.max(requested, 1), pageCount);
  const [rows, today] = await Promise.all([
    client.salesQuote.findMany({
      orderBy: { number: "desc" },
      skip: (page - 1) * QUOTE_PAGE_SIZE,
      take: QUOTE_PAGE_SIZE,
      select: {
        id: true,
        number: true,
        status: true,
        validUntil: true,
        pricesIncludeTax: true,
        taxRate: true,
        customer: { select: { name: true } },
        lines: { select: { amount: true } },
      },
    }),
    companyToday(actor.organizationId),
  ]);
  return {
    items: rows.map((row) => {
      const status = statusOf(row.status, row.validUntil, today);
      return {
        id: row.id,
        number: row.number,
        customer: row.customer.name,
        status,
        statusLabel: QUOTE_STATUS_LABELS[status],
        validUntil: dayOfDate(row.validUntil),
        total: formatMoney(
          saleTotals(
            row.lines.map((line) => line.amount.toString()),
            {
              pricesIncludeTax: row.pricesIncludeTax,
              rate: row.taxRate.toString(),
            },
          ).total,
        ),
      };
    }),
    total,
    page,
    pageCount,
  };
}

export type QuotePreview = {
  lines: { unitPrice: string | null; amount: string | null; error?: string }[];
  subtotal: string;
  taxLabel: string;
  tax: string;
  total: string;
  discount: string | null;
  discountError?: string;
};

/** What a quote being written adds up to. Reads only; prices from here. */
export async function previewQuote(
  actor: SalesActor,
  input: { lines: readonly CartLineInput[]; discountPercent?: string },
): Promise<QuotePreview> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.quote.create",
  );
  const client = forOrganization(actor.organizationId);
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(
    0,
    QUOTE_MAX_LINES,
  );
  const [{ priced, lineErrors }, rule] = await Promise.all([
    priceLines(client, lines),
    readTaxRule(client, actor.organizationId),
  ]);
  const sellable = priced.flatMap((line) => (line ? [line] : []));
  const typed = String(input.discountPercent ?? "")
    .trim()
    .slice(0, 16);
  const percent = typed === "" ? null : parsePercent(typed);
  let discountError: string | undefined;
  let taken = sellable.map(() => dec(0));
  if (typed !== "" && percent === null) {
    discountError = PERCENT_ERROR;
  } else if (percent && dec(percent).greaterThan(0) && sellable.length > 0) {
    const check = await checkDiscount(client, {
      organizationId: actor.organizationId,
      seller: await loadSubject(actor.organizationId, actor.userId),
      percent,
      lines: sellable,
    });
    taken = check.discounts;
    if (check.needsAuthorization) {
      discountError = `Tu tope de descuento es ${check.cap}.`;
    } else if (check.belowCost && !check.mayGoBelowCost) {
      discountError =
        "Con ese descuento algún producto queda por debajo de su costo.";
    }
  }
  const off = taken.reduce((sum, d) => sum.plus(d), dec(0));
  const totals = saleTotals(
    sellable.map((line, index) => line.amount.minus(taken[index]!)),
    rule,
  );
  const rate = formatTaxRate(rule.rate);
  return {
    lines: priced.map((line, index) => ({
      unitPrice: line ? `${formatMoney(line.unitPrice)} c/u` : null,
      amount: line ? formatMoney(line.amount) : null,
      ...(lineErrors[index] ? { error: lineErrors[index] } : {}),
    })),
    subtotal: formatMoney(totals.subtotal),
    taxLabel: rule.pricesIncludeTax
      ? `IVA incluido (${rate})`
      : `IVA (${rate})`,
    tax: formatMoney(totals.tax),
    total: formatMoney(totals.total),
    discount: off.isZero() ? null : `-${formatMoney(off)}`,
    ...(discountError ? { discountError } : {}),
  };
}

/** The validity a new quote is offered with: today + 15 days. */
export async function defaultQuoteValidity(actor: SalesActor): Promise<string> {
  return addDays(await companyToday(actor.organizationId), QUOTE_DEFAULT_DAYS);
}
