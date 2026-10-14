import "server-only";

import { formatDate, isAppError, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import {
  InvalidEmailError,
  purchaseOrderEmail,
  sendEmail,
} from "@/platform/email";
import { enqueueJob, type JobHandlers } from "@/platform/jobs";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { composeOrderPdf } from "./order-pdf";
import type { PurchaseOrderStatus } from "./order-states";
import { formatOrderNumber } from "./orders";
import type { PurchasingActor } from "./product-suppliers";

/**
 * Sending an order to its supplier by mail (CMP-06B). A person asks for
 * it; the worker sends it, with the PDF attached, and tries again by
 * itself when the mail does not go out. How each request ended stays on
 * the order — sent, or failed with its reason — and a failed one can be
 * asked for again.
 *
 * - **It does not move the order.** «Sent» is a person saying the order
 *   was placed (CMP-05); mailing it is a courtesy that may fail or be
 *   repeated without changing what the order is.
 * - **Only to the supplier.** The address is the one in the supplier's
 *   card, read under the lock of the order and fixed on the request; no
 *   screen sends an order to an address typed on the spot.
 * - **At least once.** The request is closed right after the mail leaves;
 *   if the worker dies between both, the next attempt sends it again.
 *   A repeated order is preferred over one believed sent that never left.
 * - **Whoever asked must still be allowed** when the worker gets to it
 *   (NEG-20): otherwise nothing leaves and the request says why.
 */

export const ORDER_DELIVERY_JOB_TYPE = "purchasing.send_order";

/** Tries before a request is given up as failed. */
export const ORDER_DELIVERY_MAX_ATTEMPTS = 4;

/** Wait before each new try: 15 s, 1 min, 5 min. */
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000];

/** Requests one order admits in a day, and a company in all. */
const DAILY_LIMIT_PER_ORDER = 5;
const DAILY_LIMIT_PER_COMPANY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const ORDER_DELIVERY_STATUS_LABELS = {
  QUEUED: "Enviando",
  SENT: "Enviado",
  FAILED: "No se envió",
} as const;

type DeliveryStatus = keyof typeof ORDER_DELIVERY_STATUS_LABELS;

/** States in which an order is something to send to a supplier. */
const SENDABLE: readonly PurchaseOrderStatus[] = ["SENT", "PARTIAL"];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FAILED_AFTER_RETRIES =
  "No se pudo entregar el correo después de varios intentos. Revisa el correo del proveedor y vuelve a enviarla.";

/** Why an order in that state is not sent by mail; null when it is. */
function stateProblem(status: PurchaseOrderStatus): string | null {
  if (SENDABLE.includes(status)) return null;
  if (status === "DRAFT") {
    return "Un borrador todavía no es un pedido: confirma la orden y después envíala.";
  }
  if (status === "CANCELLED") {
    return "Esta orden está cancelada: no se envía.";
  }
  return "Esta orden ya se recibió completa: no hace falta enviarla.";
}

/** The address a supplier can be written to, or null. */
function usableEmail(email: string | null): string | null {
  const text = (email ?? "").trim().toLowerCase();
  return text.length <= 254 && EMAIL.test(text) ? text : null;
}

const noEmail = (supplier: string) =>
  `${supplier} no tiene correo. Agrégalo en su ficha y vuelve a enviar la orden.`;

export type RequestDeliveryResult =
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

type Refusal = Extract<RequestDeliveryResult, { ok: false }>;

/** Carries an expected refusal out of a transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: Refusal) {
    super("delivery rejected");
  }
}

const refuse = (reason: Refusal["reason"], message: string) =>
  new Rejected({ ok: false, reason, message });

/**
 * Asks to send an order to its supplier by mail. The same call serves to
 * try again after a failure. While a request of the order is still on
 * its way, asking again answers with that one.
 */
export async function requestOrderDelivery(
  actor: PurchasingActor,
  orderId: string,
): Promise<RequestDeliveryResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "purchasing.order.send");
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      // The lock makes two requests of the same order happen one after
      // the other: the second one finds the first.
      const [id] = await lockRows(tx, "purchaseOrder", [
        String(orderId).slice(0, 36),
      ]);
      const order = id
        ? await tx.purchaseOrder.findFirst({
            where: { id },
            select: {
              id: true,
              number: true,
              status: true,
              contact: { select: { name: true, email: true } },
            },
          })
        : null;
      if (!order) throw refuse("not_found", "Esta orden ya no existe.");
      const problem = stateProblem(order.status);
      if (problem) throw refuse("invalid_state", problem);
      const pending = await tx.purchaseOrderDelivery.findFirst({
        where: { orderId: order.id, status: "QUEUED" },
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
      const recipient = usableEmail(order.contact.email);
      if (!recipient) {
        throw refuse("no_recipient", noEmail(order.contact.name));
      }
      const since = new Date(Date.now() - DAY_MS);
      const [ofOrder, ofCompany] = await Promise.all([
        tx.purchaseOrderDelivery.count({
          where: { orderId: order.id, requestedAt: { gte: since } },
        }),
        tx.purchaseOrderDelivery.count({
          where: { requestedAt: { gte: since } },
        }),
      ]);
      if (ofOrder >= DAILY_LIMIT_PER_ORDER) {
        throw refuse(
          "limit",
          `Esta orden ya se mandó ${DAILY_LIMIT_PER_ORDER} veces en un día. Descarga el PDF y envíalo desde tu correo, o inténtalo mañana.`,
        );
      }
      if (ofCompany >= DAILY_LIMIT_PER_COMPANY) {
        throw refuse(
          "limit",
          "Tu empresa llegó al límite de órdenes enviadas por correo en un día. Inténtalo mañana.",
        );
      }
      const deliveryId = newId();
      const { jobId } = await enqueueJob(tx, organizationId, {
        type: ORDER_DELIVERY_JOB_TYPE,
        payload: { deliveryId },
        createdByUserId: userId,
        maxAttempts: ORDER_DELIVERY_MAX_ATTEMPTS,
      });
      await tx.purchaseOrderDelivery.create({
        data: {
          id: deliveryId,
          organizationId,
          orderId: order.id,
          recipient,
          jobId,
          requestedByUserId: userId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "purchase_order.delivery_requested",
        target: { type: "purchase_order", id: order.id },
        metadata: {
          orden: formatOrderNumber(order.number),
          proveedor: order.contact.name,
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

export type OrderDelivery = {
  id: string;
  recipient: string;
  status: DeliveryStatus;
  statusLabel: string;
  requestedAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  /**
   * Only while it is on its way: tries made so far, and whether the last
   * one failed and another is waiting.
   */
  attempts?: number;
  maxAttempts?: number;
  retrying?: boolean;
};

export type OrderDeliveryPanel = {
  /** The latest requests of the order, newest first. */
  deliveries: OrderDelivery[];
  /** One is on its way: the screen keeps looking until it ends. */
  inProgress: boolean;
  /**
   * Whether it can be sent now and to whom — or why not. Present only
   * for who may send orders.
   */
  send?: { ok: true; recipient: string } | { ok: false; problem: string };
};

/** Whether the person may send orders: never an error, just yes or no. */
async function maySend(actor: PurchasingActor): Promise<boolean> {
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "purchasing.order.send",
    );
    return true;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return false;
    throw error;
  }
}

/**
 * What the screen of an order shows about its deliveries by mail; null
 * when it is not an order of the company.
 */
export async function getOrderDeliveries(
  actor: PurchasingActor,
  orderId: string,
): Promise<OrderDeliveryPanel | null> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "purchasing.order.read");
  const client = forOrganization(organizationId);
  const order = await client.purchaseOrder.findFirst({
    where: { id: String(orderId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      contact: { select: { name: true, email: true } },
    },
  });
  if (!order) return null;
  const rows = await client.purchaseOrderDelivery.findMany({
    where: { orderId: order.id },
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
          select: {
            id: true,
            status: true,
            attempts: true,
            maxAttempts: true,
          },
        })
      : [];
  const deliveries = rows.map((row): OrderDelivery => {
    const delivery: OrderDelivery = {
      id: row.id,
      recipient: row.recipient,
      status: row.status,
      statusLabel: ORDER_DELIVERY_STATUS_LABELS[row.status],
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
      // It was tried and is waiting for its turn again.
      retrying: job.attempts > 0 && job.status === "PENDING",
    };
  });
  const panel: OrderDeliveryPanel = {
    deliveries,
    inProgress: queued.length > 0,
  };
  if (!(await maySend(actor))) return panel;
  const problem = stateProblem(order.status);
  const recipient = usableEmail(order.contact.email);
  return {
    ...panel,
    send: problem
      ? { ok: false, problem }
      : recipient
        ? { ok: true, recipient }
        : { ok: false, problem: noEmail(order.contact.name) },
  };
}

type Tenant = ReturnType<typeof forOrganization>;

/**
 * Closes a request as failed, once: a request that already ended stays
 * as it ended. Leaves its line in the audit trail.
 */
async function failDelivery(
  client: Tenant,
  organizationId: string,
  deliveryId: string,
  reason: string,
): Promise<boolean> {
  return client.$transaction(async (tx) => {
    const closed = await tx.purchaseOrderDelivery.updateMany({
      where: { id: deliveryId, status: "QUEUED" },
      data: { status: "FAILED", failedAt: new Date(), failureReason: reason },
    });
    if (closed.count === 0) return false;
    const delivery = await tx.purchaseOrderDelivery.findFirst({
      where: { id: deliveryId },
      select: {
        orderId: true,
        recipient: true,
        requestedByUserId: true,
        order: { select: { number: true } },
      },
    });
    if (delivery) {
      await recordAuditEvent(tx, {
        organizationId,
        // The system gave it up; who asked for it is in the metadata.
        actorUserId: null,
        action: "purchase_order.delivery_failed",
        target: { type: "purchase_order", id: delivery.orderId },
        metadata: {
          orden: formatOrderNumber(delivery.order.number),
          correo: delivery.recipient,
          motivo: reason,
          pedidoPor: delivery.requestedByUserId,
        },
      });
    }
    return true;
  });
}

export type DeliverOutcome =
  { sent: true; recipient: string } | { sent: false; reason: string };

/**
 * Sends the order of a request (the worker). It may run more than once
 * for the same request: one that already ended is left as it ended.
 * Throws only when the mail could not leave — the queue tries again.
 */
export async function deliverOrder(
  organizationId: string,
  deliveryId: string,
): Promise<DeliverOutcome> {
  const client = forOrganization(organizationId);
  const delivery = await client.purchaseOrderDelivery.findFirst({
    where: { id: String(deliveryId).slice(0, 36) },
    select: {
      id: true,
      orderId: true,
      recipient: true,
      status: true,
      requestedByUserId: true,
    },
  });
  if (!delivery) return { sent: false, reason: "El envío ya no existe." };
  if (delivery.status !== "QUEUED") {
    return { sent: false, reason: "El envío ya había terminado." };
  }
  const stop = async (reason: string): Promise<DeliverOutcome> => {
    await failDelivery(client, organizationId, delivery.id, reason);
    return { sent: false, reason };
  };
  const actor = { organizationId, userId: delivery.requestedByUserId };

  // Whoever asked for it must still be allowed to, now (NEG-20).
  let composed;
  try {
    await assertModulePermission(
      organizationId,
      actor.userId,
      "purchasing.order.send",
    );
    composed = await composeOrderPdf(actor, delivery.orderId);
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return stop(
        "Quien pidió el envío ya no puede enviar órdenes de esta empresa. La orden no se mandó.",
      );
    }
    throw error;
  }
  if (!composed) return stop("La orden ya no existe.");
  const { order, supplier, company, pdf } = composed;
  if (!SENDABLE.includes(order.status)) {
    return stop(
      order.status === "CANCELLED"
        ? "La orden se canceló antes de mandarse. No se envió."
        : "La orden cambió de estado antes de mandarse. No se envió.",
    );
  }
  const sender = await client.membership.findFirst({
    where: { userId: actor.userId },
    select: { user: { select: { name: true, email: true } } },
  });
  if (!sender) return stop("Quien pidió el envío ya no está en la empresa.");

  try {
    await sendEmail(
      purchaseOrderEmail({
        to: delivery.recipient,
        greeting: supplier.contactPerson ?? supplier.name,
        organizationName: company.name,
        orderNumber: order.numberText,
        expectedOn: order.expectedOn
          ? formatDate(new Date(`${order.expectedOn}T12:00:00.000Z`), "UTC")
          : null,
        sender: sender.user,
        pdf: {
          name: pdf.name,
          contentType: pdf.contentType,
          content: pdf.bytes,
        },
      }),
    );
  } catch (error) {
    // A message that must not leave as it is: trying again changes nothing.
    if (error instanceof InvalidEmailError) {
      console.error(`[compras] envío ${delivery.id} rechazado:`, error);
      return stop(
        "El correo no se pudo armar con los datos del proveedor. Revisa su correo en su ficha y vuelve a enviarla.",
      );
    }
    throw error;
  }

  await client.$transaction(async (tx) => {
    const closed = await tx.purchaseOrderDelivery.updateMany({
      where: { id: delivery.id, status: "QUEUED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    if (closed.count === 0) return;
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: actor.userId,
      action: "purchase_order.delivered",
      target: { type: "purchase_order", id: order.id },
      metadata: {
        orden: order.numberText,
        proveedor: supplier.name,
        correo: delivery.recipient,
      },
    });
  });
  return { sent: true, recipient: delivery.recipient };
}

const deliveryIdOf = (payload: unknown) =>
  String((payload as { deliveryId?: unknown } | null)?.deliveryId ?? "");

/** Background work of Compras, by job type. */
export const purchasingJobHandlers: JobHandlers = {
  [ORDER_DELIVERY_JOB_TYPE]: {
    // The company is the one of the job, never one named in the payload.
    handle: (context) =>
      deliverOrder(context.organizationId, deliveryIdOf(context.payload)),
    retryDelayMs: (attempt) =>
      RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1]!,
    // No more tries: the request says so, and it can be asked for again.
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
