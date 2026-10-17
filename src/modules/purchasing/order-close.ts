import "server-only";

import { z } from "zod";

import { dec } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import { PURCHASE_ORDER_MAX_LINES, formatOrderNumber } from "./orders";
import { transitionProblem } from "./order-states";
import type { PurchasingActor } from "./product-suppliers";
import { inTermsOf, receivedByLine } from "./receipts";

/**
 * Closing an order with its shortage (CMP-11). An order received in part
 * whose rest will not come is closed: what arrived stays as it is, nothing
 * is invented for the rest, and the shortage — ordered − received of each
 * line — is fixed from then on, because a closed order takes no receipts
 * (service and trigger) and its lines no longer change.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

const closeSchema = z.object({
  reason: z
    .string({ error: "Escribe por qué se cierra." })
    .trim()
    .min(3, "Escribe por qué se cierra (al menos 3 letras).")
    .max(300, "El motivo admite hasta 300 caracteres."),
});

export type CloseOrderResult =
  | {
      ok: true;
      status: "CLOSED";
      /** «Faltaron 40 piezas de Tornillo y 2 cajas de Clavo». */
      shortageText: string;
      /** It was already closed (a double click, a retry): nothing changed. */
      repeated?: true;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "invalid_transition";
      fieldErrors: { reason?: string };
      formError?: string;
    };

type Failure = Extract<CloseOrderResult, { ok: false }>;

class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("close rejected");
  }
}

const refuse = (reason: Failure["reason"], message: string): never => {
  throw new Rejected({
    ok: false,
    reason,
    fieldErrors: {},
    formError: message,
  });
};

/** «40 piezas de Tornillo, 2 cajas de Clavo y 1 rollo de Cable». */
function listText(parts: string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

/** What is missing of each line of an order, in the terms it was ordered. */
async function shortageOf(tx: Tx, orderId: string) {
  const lines = await tx.purchaseOrderLine.findMany({
    where: { orderId },
    orderBy: { lineNumber: "asc" },
    take: PURCHASE_ORDER_MAX_LINES,
    select: {
      id: true,
      capturedQuantity: true,
      unitCode: true,
      product: { select: { name: true, sku: true } },
      presentation: { select: { name: true } },
    },
  });
  const received = await receivedByLine(
    tx,
    lines.map((line) => line.id),
  );
  return lines.flatMap((line) => {
    const left = dec(line.capturedQuantity.toString()).minus(
      received.get(line.id) ?? dec(0),
    );
    return left.greaterThan(0)
      ? [
          {
            sku: line.product.sku,
            text: `${inTermsOf(left, line.presentation, line.unitCode)} de ${line.product.name}`,
          },
        ]
      : [];
  });
}

/**
 * Closes an order received in part with what was missing (CMP-11), with
 * its reason. Only `PARTIAL` closes: with nothing received the order is
 * cancelled, and a complete one has nothing missing. Closing twice closes
 * once. Locks only the order, the last of the locks of a receipt, so a
 * receipt and a closing at the same time go one after the other.
 */
export async function closePurchaseOrder(
  actor: PurchasingActor,
  orderId: string,
  input: { reason?: unknown },
): Promise<CloseOrderResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.order.close",
  );
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      fieldErrors: { reason: parsed.error.issues[0]!.message },
    };
  }
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
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
              contact: { select: { name: true } },
            },
          })
        : null;
      if (!order) return refuse("not_found", "Esta orden ya no existe.");
      const shortage = await shortageOf(tx, order.id);
      const shortageText = listText(shortage.map((line) => line.text));
      if (order.status === "CLOSED") {
        return {
          ok: true as const,
          status: "CLOSED" as const,
          shortageText,
          repeated: true as const,
        };
      }
      const problem = transitionProblem(order.status, "CLOSED");
      if (problem) return refuse("invalid_transition", problem);
      if (shortage.length === 0) {
        // PARTIAL always misses something; this would be a defect.
        throw new Error(`Order ${order.id} is partial with nothing missing`);
      }
      await tx.purchaseOrder.updateMany({
        where: { id: order.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedByUserId: userId,
          closeReason: parsed.data.reason,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "purchase_order.closed",
        target: { type: "purchase_order", id: order.id },
        reason: parsed.data.reason,
        metadata: {
          orden: formatOrderNumber(order.number),
          proveedor: order.contact.name,
          faltante: shortageText.slice(0, 500),
          productos: shortage.length,
        },
      });
      return { ok: true as const, status: "CLOSED" as const, shortageText };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}
