import "server-only";

import { isAppError, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import {
  InvalidEmailError,
  salesStatementEmail,
  sendEmail,
} from "@/platform/email";
import { enqueueJob, type JobHandler } from "@/platform/jobs";
import { LOCKING_TRANSACTION, forOrganization } from "@/server";

import type { SalesActor } from "./prices";
import { usableEmail } from "./email-address";
import { composeStatementPdf } from "./statements";

/**
 * Mailing a customer their statement of account (PAG-06, like COT-03): a
 * person asks for it and the worker sends it with the PDF, trying again
 * by itself. Only to the address of the customer's card; whoever asked
 * must still be allowed to when the worker gets to it.
 */

export const STATEMENT_DELIVERY_JOB_TYPE = "sales.send_statement";
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000];
const DAILY_LIMIT_PER_CUSTOMER = 3;
const DAILY_LIMIT_PER_COMPANY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

const FAILED_AFTER_RETRIES =
  "No se pudo entregar el correo después de varios intentos. Revisa el correo del cliente y vuelve a enviarlo.";

export const STATEMENT_DELIVERY_STATUS_LABELS = {
  QUEUED: "Enviando",
  SENT: "Enviado",
  FAILED: "No se envió",
} as const;

export type RequestStatementDeliveryResult =
  | { ok: true; recipient: string; repeated?: true }
  | {
      ok: false;
      reason: "not_found" | "no_recipient" | "limit";
      message: string;
    };

/** Asks to mail a customer their statement. */
export async function requestStatementDelivery(
  actor: SalesActor,
  customerId: string,
): Promise<RequestStatementDeliveryResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.receivable.read");
  await assertModulePermission(organizationId, userId, "sales.customer.create");
  return forOrganization(organizationId).$transaction(async (tx) => {
    const customer = await tx.contact.findFirst({
      where: { id: String(customerId).slice(0, 36), isCustomer: true },
      select: { id: true, name: true, email: true },
    });
    if (!customer) {
      return {
        ok: false as const,
        reason: "not_found" as const,
        message: "Ese cliente ya no existe.",
      };
    }
    const pending = await tx.salesStatementDelivery.findFirst({
      where: { customerId: customer.id, status: "QUEUED" },
      select: { recipient: true },
    });
    if (pending) {
      return {
        ok: true as const,
        recipient: pending.recipient,
        repeated: true as const,
      };
    }
    const recipient = usableEmail(customer.email);
    if (!recipient) {
      return {
        ok: false as const,
        reason: "no_recipient" as const,
        message: `${customer.name} no tiene correo. Agrégalo para enviarle su estado de cuenta.`,
      };
    }
    const since = new Date(Date.now() - DAY_MS);
    const [ofCustomer, ofCompany] = await Promise.all([
      tx.salesStatementDelivery.count({
        where: { customerId: customer.id, requestedAt: { gte: since } },
      }),
      tx.salesStatementDelivery.count({
        where: { requestedAt: { gte: since } },
      }),
    ]);
    if (ofCustomer >= DAILY_LIMIT_PER_CUSTOMER) {
      return {
        ok: false as const,
        reason: "limit" as const,
        message: `A este cliente ya se le mandó ${DAILY_LIMIT_PER_CUSTOMER} veces hoy. Descarga el PDF y envíalo desde tu correo, o inténtalo mañana.`,
      };
    }
    if (ofCompany >= DAILY_LIMIT_PER_COMPANY) {
      return {
        ok: false as const,
        reason: "limit" as const,
        message:
          "Tu empresa llegó al límite de estados de cuenta enviados por correo en un día. Inténtalo mañana.",
      };
    }
    const deliveryId = newId();
    const { jobId } = await enqueueJob(tx, organizationId, {
      type: STATEMENT_DELIVERY_JOB_TYPE,
      payload: { deliveryId },
      createdByUserId: userId,
      maxAttempts: MAX_ATTEMPTS,
    });
    await tx.salesStatementDelivery.create({
      data: {
        id: deliveryId,
        organizationId,
        customerId: customer.id,
        recipient,
        jobId,
        requestedByUserId: userId,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "sales.statement_delivery_requested",
      target: { type: "contact", id: customer.id },
      metadata: { cliente: customer.name, correo: recipient },
    });
    return { ok: true as const, recipient };
  }, LOCKING_TRANSACTION);
}

export type StatementDelivery = {
  id: string;
  recipient: string;
  statusLabel: string;
  status: keyof typeof STATEMENT_DELIVERY_STATUS_LABELS;
  requestedAt: Date;
  failureReason: string | null;
};

/** The latest mails of a customer's statement. */
export async function getStatementDeliveries(
  actor: SalesActor,
  customerId: string,
): Promise<StatementDelivery[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.receivable.read",
  );
  const rows = await forOrganization(
    actor.organizationId,
  ).salesStatementDelivery.findMany({
    where: { customerId: String(customerId).slice(0, 36) },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: 5,
    select: {
      id: true,
      recipient: true,
      status: true,
      requestedAt: true,
      failureReason: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    statusLabel: STATEMENT_DELIVERY_STATUS_LABELS[row.status],
  }));
}

type Tenant = ReturnType<typeof forOrganization>;

async function failDelivery(
  client: Tenant,
  organizationId: string,
  deliveryId: string,
  reason: string,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const closed = await tx.salesStatementDelivery.updateMany({
      where: { id: deliveryId, status: "QUEUED" },
      data: { status: "FAILED", failedAt: new Date(), failureReason: reason },
    });
    if (closed.count === 0) return;
    const delivery = await tx.salesStatementDelivery.findFirst({
      where: { id: deliveryId },
      select: { customerId: true, recipient: true, requestedByUserId: true },
    });
    if (delivery) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: null,
        action: "sales.statement_delivery_failed",
        target: { type: "contact", id: delivery.customerId },
        metadata: {
          correo: delivery.recipient,
          motivo: reason,
          pedidoPor: delivery.requestedByUserId,
        },
      });
    }
  });
}

/**
 * Sends the statement of a request (the worker). It may run more than once
 * for the same request: one that already ended is left as it ended.
 */
export async function deliverStatement(
  organizationId: string,
  deliveryId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const client = forOrganization(organizationId);
  const delivery = await client.salesStatementDelivery.findFirst({
    where: { id: String(deliveryId).slice(0, 36) },
    select: {
      id: true,
      customerId: true,
      recipient: true,
      status: true,
      requestedByUserId: true,
    },
  });
  if (!delivery) return { sent: false, reason: "El envío ya no existe." };
  if (delivery.status !== "QUEUED") {
    return { sent: false, reason: "El envío ya había terminado." };
  }
  const stop = async (reason: string) => {
    await failDelivery(client, organizationId, delivery.id, reason);
    return { sent: false, reason };
  };
  const actor = { organizationId, userId: delivery.requestedByUserId };
  let composed;
  try {
    await assertModulePermission(
      organizationId,
      actor.userId,
      "sales.customer.create",
    );
    composed = await composeStatementPdf(actor, delivery.customerId);
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return stop(
        "Quien pidió el envío ya no puede enviar estados de cuenta de esta empresa. No se mandó.",
      );
    }
    throw error;
  }
  if (!composed) return stop("El cliente ya no existe.");
  const sender = await client.membership.findFirst({
    where: { userId: actor.userId },
    select: { user: { select: { name: true, email: true } } },
  });
  if (!sender) return stop("Quien pidió el envío ya no está en la empresa.");
  const { statement, company, pdf } = composed;
  const next = statement.upcoming[0];
  try {
    await sendEmail(
      salesStatementEmail({
        to: delivery.recipient,
        greeting: statement.customer.name,
        organizationName: company.name,
        balance: statement.balance,
        next: next ? { dueText: next.dueText, amount: next.left } : null,
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
      return stop(
        "El correo no se pudo armar con los datos del cliente. Revisa su correo y vuelve a enviarlo.",
      );
    }
    throw error;
  }
  await client.$transaction(async (tx) => {
    const closed = await tx.salesStatementDelivery.updateMany({
      where: { id: delivery.id, status: "QUEUED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    if (closed.count === 0) return;
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: actor.userId,
      action: "sales.statement_delivered",
      target: { type: "contact", id: delivery.customerId },
      metadata: {
        cliente: statement.customer.name,
        correo: delivery.recipient,
      },
    });
  });
  return { sent: true };
}

const deliveryIdOf = (payload: unknown) =>
  String((payload as { deliveryId?: unknown } | null)?.deliveryId ?? "");

export const statementJobHandler: JobHandler = {
  // The company is the one of the job, never one named in the payload.
  handle: (context) =>
    deliverStatement(context.organizationId, deliveryIdOf(context.payload)),
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
};
