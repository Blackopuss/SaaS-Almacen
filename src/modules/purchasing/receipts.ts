import "server-only";

import { z } from "zod";

import { dec, formatDecimal, newId } from "@/lib";
import { formatStock, postReceiptEntry } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { pluralizeName, type Capture } from "@/platform/catalog";
import { formatLocationPath } from "@/platform/locations";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import {
  PURCHASE_ORDER_MAX_LINES,
  advanceOrderOnReceipt,
  formatOrderNumber,
} from "./orders";
import {
  PURCHASE_ORDER_STATUS_LABELS,
  transitionProblem,
  type PurchaseOrderStatus,
} from "./order-states";
import type { PurchasingActor } from "./product-suppliers";

/**
 * Receipts of purchase orders (CMP-07). Receiving writes, in one
 * transaction, the receipt with its lines, the entry of stock (a `RECEIPT`
 * movement, written by Inventario) and the new state of the order: the
 * goods are in stock and the order says so, or nothing happened.
 *
 * What is pending of a line is counted in the terms it was ordered in
 * (3 boxes ordered, 1 received → 2 boxes pending); what enters stock is
 * converted with the content of the presentation in force when it arrives.
 *
 * Order of locks, as every movement: products → location → order.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Decimal = ReturnType<typeof dec>;

/** Random text chosen by whoever shows the form: a UUID fits. */
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

const KEY_REUSED =
  "Esta confirmación ya se usó para otra recepción. Recarga la página para registrar una nueva.";

const receiveSchema = z.object({
  /** Empty = the default location, «General». */
  locationId: z
    .string()
    .trim()
    .max(36)
    .optional()
    .transform((value) => value || null),
  reference: z
    .string()
    .trim()
    .regex(
      /^[^\u0000-\u001f\u007f]*$/,
      "Quita los saltos de línea o tabuladores.",
    )
    .max(80, "La remisión admite hasta 80 caracteres.")
    .optional()
    .transform((value) => value || null),
  idempotencyKey: z
    .string()
    .regex(KEY, "Recarga la página para registrar la recepción."),
});

export type ReceiveInput = z.input<typeof receiveSchema>;
export type ReceiveField = "locationId" | "reference";

export type ReceiveResult =
  | {
      ok: true;
      receiptId: string;
      status: PurchaseOrderStatus;
      /** «Recibiste 3 productos de OC-0007 en General…». */
      summary: string;
      /** It had already been registered (a retry): nothing was written now. */
      repeated?: true;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_allowed" | "invalid_transition";
      fieldErrors: Partial<Record<ReceiveField, string>>;
      formError?: string;
    };

type Failure = Extract<ReceiveResult, { ok: false }>;

/** Carries an expected refusal out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("receipt rejected");
  }
}

const refuse = (
  reason: Failure["reason"],
  field: ReceiveField | null,
  message: string,
): never => {
  throw new Rejected({
    ok: false,
    reason,
    fieldErrors: field ? { [field]: message } : {},
    ...(field ? {} : { formError: message }),
  });
};

/** What has arrived of each line of an order, in the terms it was ordered in. */
async function receivedByLine(
  client: Pick<Tx, "purchaseReceiptLine">,
  orderLineIds: string[],
): Promise<Map<string, Decimal>> {
  if (orderLineIds.length === 0) return new Map();
  const rows = await client.purchaseReceiptLine.groupBy({
    by: ["orderLineId"],
    where: { orderLineId: { in: orderLineIds } },
    _sum: { capturedQuantity: true },
  });
  return new Map(
    rows.map((row) => [
      row.orderLineId,
      dec(row._sum.capturedQuantity?.toString() ?? 0),
    ]),
  );
}

/**
 * Receives everything still pending of an order (CMP-07) in one location:
 * the receipt, the entry of stock and the order marked as received, in
 * one transaction. Repeating the confirmation (a double click, a retry
 * after a lost answer) receives once.
 */
export async function receivePurchaseOrder(
  actor: PurchasingActor,
  orderId: string,
  input: ReceiveInput,
): Promise<ReceiveResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.receipt.create",
  );
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ReceiveField, string>> = {};
    let formError: string | undefined;
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "locationId" || field === "reference") {
        fieldErrors[field] ??= issue.message;
      } else {
        formError ??= issue.message;
      }
    }
    return { ok: false, reason: "invalid", fieldErrors, formError };
  }
  const data = parsed.data;
  const client = forOrganization(organizationId);

  // The lines of an order that is no longer a draft never change
  // (triggers), so reading them before locking is safe; they tell which
  // products to lock.
  const order = await client.purchaseOrder.findFirst({
    where: { id: String(orderId).slice(0, 36) },
    select: {
      id: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        take: PURCHASE_ORDER_MAX_LINES,
        select: { productId: true },
      },
    },
  });
  if (!order) {
    return {
      ok: false,
      reason: "not_found",
      fieldErrors: {},
      formError: "Esta orden ya no existe.",
    };
  }

  try {
    return await client.$transaction(async (tx) => {
      await lockRows(
        tx,
        "product",
        order.lines.map((line) => line.productId),
      );
      if (data.locationId) await lockRows(tx, "location", [data.locationId]);
      await lockRows(tx, "purchaseOrder", [order.id]);

      // A retry answers with the receipt it already wrote, before any other
      // check: by now the order is received because of that very receipt.
      const replay = await tx.purchaseReceipt.findFirst({
        where: { idempotencyKey: data.idempotencyKey },
        select: {
          id: true,
          orderId: true,
          receivedByUserId: true,
          order: { select: { status: true, number: true } },
        },
      });
      if (replay) {
        if (replay.orderId !== order.id || replay.receivedByUserId !== userId) {
          return refuse("not_allowed", null, KEY_REUSED);
        }
        return {
          ok: true as const,
          receiptId: replay.id,
          status: replay.order.status,
          repeated: true as const,
          summary: `Esta recepción de ${formatOrderNumber(replay.order.number)} ya estaba registrada. No se registró de nuevo.`,
        };
      }

      const current = await tx.purchaseOrder.findFirst({
        where: { id: order.id },
        select: {
          id: true,
          number: true,
          status: true,
          contact: { select: { name: true } },
          lines: {
            orderBy: { lineNumber: "asc" },
            take: PURCHASE_ORDER_MAX_LINES,
            select: {
              id: true,
              productId: true,
              capturedQuantity: true,
              presentationId: true,
            },
          },
        },
      });
      if (!current)
        return refuse("not_found", null, "Esta orden ya no existe.");
      if (current.status !== "SENT" && current.status !== "PARTIAL") {
        return refuse(
          "invalid_transition",
          null,
          transitionProblem(current.status, "RECEIVED") ??
            "Esta orden no está esperando mercancía.",
        );
      }

      const received = await receivedByLine(
        tx,
        current.lines.map((line) => line.id),
      );
      const pending = current.lines
        .map((line) => ({
          line,
          quantity: dec(line.capturedQuantity.toString()).minus(
            received.get(line.id) ?? 0,
          ),
        }))
        .filter((entry) => entry.quantity.greaterThan(0));
      if (pending.length === 0) {
        return refuse(
          "invalid",
          null,
          "Ya se recibió todo lo que pide esta orden.",
        );
      }

      const numberText = formatOrderNumber(current.number);
      const entry = await postReceiptEntry(
        tx,
        { organizationId, userId },
        {
          locationId: data.locationId,
          lines: pending.map(({ line, quantity }) => ({
            productId: line.productId,
            capture: (line.presentationId
              ? {
                  kind: "presentation",
                  quantity: quantity.toString(),
                  presentationId: line.presentationId,
                }
              : { kind: "base", quantity: quantity.toString() }) as Capture,
          })),
          reference: data.reference
            ? `${numberText} · ${data.reference}`
            : numberText,
          reason:
            `Recepción de la orden ${numberText} de ${current.contact.name}`.slice(
              0,
              500,
            ),
        },
      );
      if (!entry.ok) {
        return refuse(
          "invalid",
          entry.line === null ? "locationId" : null,
          entry.error,
        );
      }

      const receiptId = newId();
      await tx.purchaseReceipt.create({
        data: {
          id: receiptId,
          organizationId,
          orderId: current.id,
          movementId: entry.movementId,
          reference: data.reference,
          idempotencyKey: data.idempotencyKey,
          receivedByUserId: userId,
        },
      });
      await tx.purchaseReceiptLine.createMany({
        data: entry.lines.map((line, index) => ({
          id: newId(),
          organizationId,
          receiptId,
          lineNumber: line.lineNumber,
          orderLineId: pending[index]!.line.id,
          productId: line.productId,
          locationId: entry.locationId,
          capturedQuantity: line.capturedQuantity.toString(),
          presentationId: line.presentationId,
          presentationVersionId: line.presentationVersionId,
          factor: line.factor.toString(),
          baseQuantity: line.baseQuantity.toString(),
          unitCode: line.unitCode,
        })),
      });

      // Everything pending arrived: the order is received.
      const status: PurchaseOrderStatus = "RECEIVED";
      await advanceOrderOnReceipt(tx, current.id, status);
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "purchase_order.received",
        target: { type: "purchase_order", id: current.id },
        metadata: {
          orden: numberText,
          proveedor: current.contact.name,
          productos: entry.lines.length,
          ubicacion: entry.locationName,
          ...(data.reference ? { remision: data.reference } : {}),
          estado: PURCHASE_ORDER_STATUS_LABELS[status],
        },
      });
      const count = entry.lines.length;
      return {
        ok: true as const,
        receiptId,
        status,
        summary: `Recibiste ${count === 1 ? "1 producto" : `${count} productos`} de ${numberText} en ${entry.locationName}. La orden quedó recibida.`,
      };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    // The same key arrived at once for another order (the order locks did
    // not put them in line): the database kept one receipt.
    if (
      (error as { code?: string }).code === "P2002" &&
      JSON.stringify((error as { meta?: unknown }).meta ?? "").includes(
        "idempotencyKey",
      )
    ) {
      return {
        ok: false,
        reason: "not_allowed",
        fieldErrors: {},
        formError: KEY_REUSED,
      };
    }
    throw error;
  }
}

/**
 * Whether a confirmation reached the server although its answer was lost
 * (INV-22): the receipt that key wrote for this person, if any.
 */
export async function findReceiptConfirmation(
  actor: PurchasingActor,
  idempotencyKey: string,
): Promise<{ receiptId: string; orderId: string } | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.receipt.read",
  );
  const key = String(idempotencyKey ?? "").trim();
  if (!KEY.test(key)) return null;
  const receipt = await forOrganization(
    actor.organizationId,
  ).purchaseReceipt.findFirst({
    where: { idempotencyKey: key, receivedByUserId: actor.userId },
    select: { id: true, orderId: true },
  });
  return receipt ? { receiptId: receipt.id, orderId: receipt.orderId } : null;
}

export type PendingLine = {
  orderLineId: string;
  lineNumber: number;
  productName: string;
  sku: string;
  /** «3 cajas» or «25 piezas»: as it was ordered. */
  orderedText: string;
  /** Null while nothing of it arrived. */
  receivedText: string | null;
  /** Null when it all arrived. */
  pendingText: string | null;
};

export type ReceiptSummary = {
  id: string;
  createdAt: Date;
  authorName: string | null;
  reference: string | null;
  lines: {
    productName: string;
    sku: string;
    /** «3 cajas × 100 = 300 piezas» with the content it was received with. */
    quantityText: string;
    locationPath: string;
  }[];
};

export type OrderReceipts = {
  /** Something of it is still pending and the order is waiting for it. */
  canReceive: boolean;
  lines: PendingLine[];
  /** Newest first. */
  receipts: ReceiptSummary[];
};

/** «3 cajas», «2.5 metros»: a quantity in the terms of an order line. */
function inTermsOf(
  quantity: Decimal,
  presentation: { name: string } | null,
  unitCode: string,
): string {
  return presentation
    ? `${formatDecimal(quantity)} ${pluralizeName(presentation.name, quantity).toLowerCase()}`
    : formatStock(quantity.toString(), unitCode);
}

/**
 * What arrived of an order and what is still pending, with its receipts
 * (CMP-07). Null when it is not an order of the company.
 */
export async function getOrderReceipts(
  actor: PurchasingActor,
  orderId: string,
): Promise<OrderReceipts | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.receipt.read",
  );
  const client = forOrganization(actor.organizationId);
  const order = await client.purchaseOrder.findFirst({
    where: { id: String(orderId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        take: PURCHASE_ORDER_MAX_LINES,
        select: {
          id: true,
          lineNumber: true,
          capturedQuantity: true,
          unitCode: true,
          product: { select: { name: true, sku: true } },
          presentation: { select: { name: true } },
        },
      },
      receipts: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true,
          createdAt: true,
          reference: true,
          receivedByUserId: true,
          lines: {
            orderBy: { lineNumber: "asc" },
            select: {
              capturedQuantity: true,
              factor: true,
              baseQuantity: true,
              unitCode: true,
              product: { select: { name: true, sku: true } },
              presentation: { select: { name: true } },
              location: {
                select: {
                  name: true,
                  parent: {
                    select: { name: true, parent: { select: { name: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const received = await receivedByLine(
    client,
    order.lines.map((line) => line.id),
  );
  const lines = order.lines.map((line): PendingLine => {
    const ordered = dec(line.capturedQuantity.toString());
    const got = received.get(line.id) ?? dec(0);
    const left = ordered.minus(got);
    return {
      orderLineId: line.id,
      lineNumber: line.lineNumber,
      productName: line.product.name,
      sku: line.product.sku,
      orderedText: inTermsOf(ordered, line.presentation, line.unitCode),
      receivedText: got.greaterThan(0)
        ? inTermsOf(got, line.presentation, line.unitCode)
        : null,
      pendingText: left.greaterThan(0)
        ? inTermsOf(left, line.presentation, line.unitCode)
        : null,
    };
  });

  const authors = await client.membership.findMany({
    where: {
      userId: {
        in: [...new Set(order.receipts.map((r) => r.receivedByUserId))],
      },
    },
    select: { userId: true, user: { select: { name: true } } },
  });
  const names = new Map(authors.map((row) => [row.userId, row.user.name]));

  return {
    canReceive:
      (order.status === "SENT" || order.status === "PARTIAL") &&
      lines.some((line) => line.pendingText !== null),
    lines,
    receipts: order.receipts.map((receipt) => ({
      id: receipt.id,
      createdAt: receipt.createdAt,
      authorName: names.get(receipt.receivedByUserId) ?? null,
      reference: receipt.reference,
      lines: receipt.lines.map((line) => {
        const captured = dec(line.capturedQuantity.toString());
        const base = formatStock(line.baseQuantity.toString(), line.unitCode);
        return {
          productName: line.product.name,
          sku: line.product.sku,
          quantityText: line.presentation
            ? `${inTermsOf(captured, line.presentation, line.unitCode)} × ${formatDecimal(line.factor.toString())} = ${base}`
            : base,
          locationPath: formatLocationPath(
            [
              line.location.parent?.parent?.name,
              line.location.parent?.name,
              line.location.name,
            ].filter((name): name is string => Boolean(name)),
          ),
        };
      }),
    })),
  };
}
