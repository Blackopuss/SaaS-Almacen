import "server-only";

import { formatDate, isAppError, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import {
  InvalidEmailError,
  salesQuoteEmail,
  sendEmail,
} from "@/platform/email";
import { enqueueJob, type JobHandlers } from "@/platform/jobs";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { companyToday, dayOfDate } from "./calendar";
import { usableEmail } from "./email-address";
import type { SalesActor } from "./prices";
import { composeQuotePdf } from "./quote-pdf";
import {
  STATEMENT_DELIVERY_JOB_TYPE,
  statementJobHandler,
} from "./statement-delivery";

/**
 * Sending a quote to its customer by mail (COT-03, like CMP-06B). A person
 * asks for it; the worker sends it, with the PDF attached, and tries again
 * by itself when the mail does not go out. How each request ended stays
 * on the quote, and a failed one can be asked for again.
 *
 * - **Asking for it sends the quote.** A draft becomes «Enviada» in the
 *   same transaction: what reaches the customer can no longer change.
 * - **Only to the customer.** The address is the one in the customer's
 *   card, read under the lock of the quote; no screen sends a quote to an
 *   address typed on the spot.
 * - **At least once**, and whoever asked must still be allowed to when the
 *   worker gets to it (NEG-20).
 */

export const QUOTE_DELIVERY_JOB_TYPE = "sales.send_quote";
export const QUOTE_DELIVERY_MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000];
const DAILY_LIMIT_PER_QUOTE = 5;
const DAILY_LIMIT_PER_COMPANY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const QUOTE_DELIVERY_STATUS_LABELS = {
  QUEUED: "Enviando",
  SENT: "Enviado",
  FAILED: "No se envió",
} as const;

type DeliveryStatus = keyof typeof QUOTE_DELIVERY_STATUS_LABELS;

const FAILED_AFTER_RETRIES =
  "No se pudo entregar el correo después de varios intentos. Revisa el correo del cliente y vuelve a enviarla.";

export { usableEmail };

const noEmail = (customer: string) =>
  `${customer} no tiene correo. Agrégalo para enviarle la cotización.`;

/** Why a quote in that state is not mailed; null when it is. */
function stateProblem(
  status: string,
  validUntil: Date,
  today: string,
): string | null {
  if (status === "ACCEPTED") return "Esta cotización ya se aceptó.";
  if (status === "REJECTED") return "Esta cotización se rechazó.";
  if (dayOfDate(validUntil) < today) {
    return "Esta cotización ya venció: haz una nueva con los precios de hoy.";
  }
  return null;
}

export type RequestQuoteDeliveryResult =
  | {
      ok: true;
      deliveryId: string;
      recipient: string;
      /** There was already one on its way: nothing new was asked for. */
      repeated?: true;
    }
  | {
      ok: false;
      reason: "not_found" | "invalid_state" | "no_recipient" | "limit";
      message: string;
    };

type Refusal = Extract<RequestQuoteDeliveryResult, { ok: false }>;

class Rejected extends Error {
  constructor(readonly result: Refusal) {
    super("delivery rejected");
  }
}

const refuse = (reason: Refusal["reason"], message: string) =>
  new Rejected({ ok: false, reason, message });

/**
 * Asks to mail a quote to its customer. The same call tries again after a
 * failure; while one is on its way, asking again answers with that one.
 */
export async function requestQuoteDelivery(
  actor: SalesActor,
  quoteId: string,
): Promise<RequestQuoteDeliveryResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.quote.create");
  const today = await companyToday(organizationId);
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      const [id] = await lockRows(tx, "salesQuote", [
        String(quoteId).slice(0, 36),
      ]);
      const quote = id
        ? await tx.salesQuote.findFirst({
            where: { id },
            select: {
              id: true,
              number: true,
              status: true,
              validUntil: true,
              customer: { select: { name: true, email: true } },
            },
          })
        : null;
      if (!quote) throw refuse("not_found", "Esta cotización ya no existe.");
      const problem = stateProblem(quote.status, quote.validUntil, today);
      if (problem) throw refuse("invalid_state", problem);
      const pending = await tx.salesQuoteDelivery.findFirst({
        where: { quoteId: quote.id, status: "QUEUED" },
        select: { id: true, recipient: true },
      });
      if (pending) {
        return {
          ok: true as const,
          deliveryId: pending.id,
          recipient: pending.recipient,
          repeated: true as const,
        };
      }
      const recipient = usableEmail(quote.customer.email);
      if (!recipient) {
        throw refuse("no_recipient", noEmail(quote.customer.name));
      }
      const since = new Date(Date.now() - DAY_MS);
      const [ofQuote, ofCompany] = await Promise.all([
        tx.salesQuoteDelivery.count({
          where: { quoteId: quote.id, requestedAt: { gte: since } },
        }),
        tx.salesQuoteDelivery.count({
          where: { requestedAt: { gte: since } },
        }),
      ]);
      if (ofQuote >= DAILY_LIMIT_PER_QUOTE) {
        throw refuse(
          "limit",
          `Esta cotización ya se mandó ${DAILY_LIMIT_PER_QUOTE} veces en un día. Descarga el PDF y envíalo desde tu correo, o inténtalo mañana.`,
        );
      }
      if (ofCompany >= DAILY_LIMIT_PER_COMPANY) {
        throw refuse(
          "limit",
          "Tu empresa llegó al límite de cotizaciones enviadas por correo en un día. Inténtalo mañana.",
        );
      }
      // What goes to the customer no longer changes.
      if (quote.status === "DRAFT") {
        await tx.salesQuote.update({
          where: { id: quote.id },
          data: { status: "SENT", sentAt: new Date() },
        });
        await recordAuditEvent(tx, {
          organizationId,
          actorUserId: userId,
          action: "sales.quote_sent",
          target: { type: "sales_quote", id: quote.id },
          metadata: { cotizacion: String(quote.number) },
        });
      }
      const deliveryId = newId();
      const { jobId } = await enqueueJob(tx, organizationId, {
        type: QUOTE_DELIVERY_JOB_TYPE,
        payload: { deliveryId },
        createdByUserId: userId,
        maxAttempts: QUOTE_DELIVERY_MAX_ATTEMPTS,
      });
      await tx.salesQuoteDelivery.create({
        data: {
          id: deliveryId,
          organizationId,
          quoteId: quote.id,
          recipient,
          jobId,
          requestedByUserId: userId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "sales.quote_delivery_requested",
        target: { type: "sales_quote", id: quote.id },
        metadata: {
          cotizacion: String(quote.number),
          cliente: quote.customer.name,
          correo: recipient,
        },
      });
      return { ok: true as const, deliveryId, recipient };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

export type QuoteDelivery = {
  id: string;
  recipient: string;
  status: DeliveryStatus;
  statusLabel: string;
  requestedAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  attempts?: number;
  maxAttempts?: number;
  retrying?: boolean;
};

export type QuoteDeliveryPanel = {
  deliveries: QuoteDelivery[];
  inProgress: boolean;
  /** Present only for who may send quotes. */
  send?:
    | { ok: true; recipient: string }
    | { ok: false; problem: string; missingEmail?: { customerId: string } };
};

async function maySend(actor: SalesActor): Promise<boolean> {
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "sales.quote.create",
    );
    return true;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return false;
    throw error;
  }
}

/** What the screen of a quote shows about its mails; null when it is not one. */
export async function getQuoteDeliveries(
  actor: SalesActor,
  quoteId: string,
): Promise<QuoteDeliveryPanel | null> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.quote.read");
  const client = forOrganization(organizationId);
  const quote = await client.salesQuote.findFirst({
    where: { id: String(quoteId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      validUntil: true,
      customerId: true,
      customer: { select: { name: true, email: true } },
    },
  });
  if (!quote) return null;
  const rows = await client.salesQuoteDelivery.findMany({
    where: { quoteId: quote.id },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: 10,
    select: {
      id: true,
      recipient: true,
      status: true,
      jobId: true,
      requestedAt: true,
      sentAt: true,
      failedAt: true,
      failureReason: true,
    },
  });
  const queued = rows.filter((row) => row.status === "QUEUED");
  const jobs =
    queued.length > 0
      ? await client.job.findMany({
          where: { id: { in: queued.map((row) => row.jobId) } },
          select: { id: true, status: true, attempts: true, maxAttempts: true },
        })
      : [];
  const deliveries = rows.map((row): QuoteDelivery => {
    const delivery: QuoteDelivery = {
      id: row.id,
      recipient: row.recipient,
      status: row.status,
      statusLabel: QUOTE_DELIVERY_STATUS_LABELS[row.status],
      requestedAt: row.requestedAt,
      sentAt: row.sentAt,
      failedAt: row.failedAt,
      failureReason: row.failureReason,
    };
    const job = jobs.find((candidate) => candidate.id === row.jobId);
    if (row.status !== "QUEUED" || !job) return delivery;
    return {
      ...delivery,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      retrying: job.attempts > 0 && job.status === "PENDING",
    };
  });
  const panel: QuoteDeliveryPanel = {
    deliveries,
    inProgress: queued.length > 0,
  };
  if (!(await maySend(actor))) return panel;
  const problem = stateProblem(
    quote.status,
    quote.validUntil,
    await companyToday(organizationId),
  );
  const recipient = usableEmail(quote.customer.email);
  return {
    ...panel,
    send: problem
      ? { ok: false, problem }
      : recipient
        ? { ok: true, recipient }
        : {
            ok: false,
            problem: noEmail(quote.customer.name),
            missingEmail: { customerId: quote.customerId },
          },
  };
}

type Tenant = ReturnType<typeof forOrganization>;

async function failDelivery(
  client: Tenant,
  organizationId: string,
  deliveryId: string,
  reason: string,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    const closed = await tx.salesQuoteDelivery.updateMany({
      where: { id: deliveryId, status: "QUEUED" },
      data: { status: "FAILED", failedAt: new Date(), failureReason: reason },
    });
    if (closed.count === 0) return false;
    const delivery = await tx.salesQuoteDelivery.findFirst({
      where: { id: deliveryId },
      select: {
        quoteId: true,
        recipient: true,
        requestedByUserId: true,
        quote: { select: { number: true } },
      },
    });
    if (delivery) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: null,
        action: "sales.quote_delivery_failed",
        target: { type: "sales_quote", id: delivery.quoteId },
        metadata: {
          cotizacion: String(delivery.quote.number),
          correo: delivery.recipient,
          motivo: reason,
          pedidoPor: delivery.requestedByUserId,
        },
      });
    }
    return true;
  });
}

export type DeliverQuoteOutcome =
  { sent: true; recipient: string } | { sent: false; reason: string };

/**
 * Sends the quote of a request (the worker). It may run more than once for
 * the same request: one that already ended is left as it ended. Throws
 * only when the mail could not leave — the queue tries again.
 */
export async function deliverQuote(
  organizationId: string,
  deliveryId: string,
): Promise<DeliverQuoteOutcome> {
  const client = forOrganization(organizationId);
  const delivery = await client.salesQuoteDelivery.findFirst({
    where: { id: String(deliveryId).slice(0, 36) },
    select: {
      id: true,
      quoteId: true,
      recipient: true,
      status: true,
      requestedByUserId: true,
    },
  });
  if (!delivery) return { sent: false, reason: "El envío ya no existe." };
  if (delivery.status !== "QUEUED") {
    return { sent: false, reason: "El envío ya había terminado." };
  }
  const stop = async (reason: string): Promise<DeliverQuoteOutcome> => {
    await failDelivery(client, organizationId, delivery.id, reason);
    return { sent: false, reason };
  };
  const actor = { organizationId, userId: delivery.requestedByUserId };

  let composed;
  try {
    await assertModulePermission(
      organizationId,
      actor.userId,
      "sales.quote.create",
    );
    composed = await composeQuotePdf(actor, delivery.quoteId);
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return stop(
        "Quien pidió el envío ya no puede enviar cotizaciones de esta empresa. La cotización no se mandó.",
      );
    }
    throw error;
  }
  if (!composed) return stop("La cotización ya no existe.");
  const { quote, company, pdf } = composed;
  if (quote.status === "REJECTED") {
    return stop("La cotización se rechazó antes de mandarse. No se envió.");
  }
  const sender = await client.membership.findFirst({
    where: { userId: actor.userId },
    select: { user: { select: { name: true, email: true } } },
  });
  if (!sender) return stop("Quien pidió el envío ya no está en la empresa.");

  try {
    await sendEmail(
      salesQuoteEmail({
        to: delivery.recipient,
        greeting: quote.customer.name,
        organizationName: company.name,
        quoteNumber: quote.number,
        validUntil: formatDate(
          new Date(`${quote.validUntil}T12:00:00.000Z`),
          "UTC",
        ),
        total: quote.total,
        sender: sender.user,
        pdf: {
          name: pdf.name,
          contentType: pdf.contentType,
          content: pdf.bytes,
        },
      }),
    );
  } catch (error) {
    if (error instanceof InvalidEmailError) {
      console.error(`[ventas] envío ${delivery.id} rechazado:`, error);
      return stop(
        "El correo no se pudo armar con los datos del cliente. Revisa su correo y vuelve a enviarla.",
      );
    }
    throw error;
  }

  await client.$transaction(async (tx) => {
    const closed = await tx.salesQuoteDelivery.updateMany({
      where: { id: delivery.id, status: "QUEUED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    if (closed.count === 0) return;
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: actor.userId,
      action: "sales.quote_delivered",
      target: { type: "sales_quote", id: quote.id },
      metadata: {
        cotizacion: String(quote.number),
        cliente: quote.customer.name,
        correo: delivery.recipient,
      },
    });
  });
  return { sent: true, recipient: delivery.recipient };
}

const deliveryIdOf = (payload: unknown) =>
  String((payload as { deliveryId?: unknown } | null)?.deliveryId ?? "");

/** Background work of Ventas, by job type. */
export const salesJobHandlers: JobHandlers = {
  [STATEMENT_DELIVERY_JOB_TYPE]: statementJobHandler,
  [QUOTE_DELIVERY_JOB_TYPE]: {
    // The company is the one of the job, never one named in the payload.
    handle: (context) =>
      deliverQuote(context.organizationId, deliveryIdOf(context.payload)),
    retryDelayMs: (attempt) =>
      RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1]!,
    onFailed: async (context) => {
      await failDelivery(
        forOrganization(context.organizationId),
        context.organizationId,
        deliveryIdOf(context.payload),
        FAILED_AFTER_RETRIES,
      );
    },
  },
};
