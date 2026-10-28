import "server-only";

import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import type { SalesActor } from "./prices";

/**
 * Cancelling an order (COT-09, ADR 0030): what is missing is no longer
 * delivered. Nothing was reserved (COT-06), so nothing is released; what
 * was delivered stays sold, and if the customer gives it back it is a
 * return of its sale. Once, with who, when and why.
 */

export type CancelOrderResult =
  | { ok: true; repeated?: true }
  | {
      ok: false;
      reason: "not_found" | "invalid_state" | "invalid";
      error: string;
    };

const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

export async function cancelSalesOrder(
  actor: SalesActor,
  orderId: string,
  reason: string,
): Promise<CancelOrderResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.sale.cancel");
  const why = String(reason ?? "").trim();
  if (why.length < 3 || why.length > 500 || !NO_CONTROL.test(why)) {
    return {
      ok: false,
      reason: "invalid",
      error: "Escribe el motivo (de 3 a 500 caracteres).",
    };
  }
  return forOrganization(organizationId).$transaction(async (tx) => {
    const [id] = await lockRows(tx, "salesOrder", [
      String(orderId).slice(0, 36),
    ]);
    const order = id
      ? await tx.salesOrder.findFirst({
          where: { id },
          select: { id: true, number: true, status: true },
        })
      : null;
    if (!order) {
      return {
        ok: false as const,
        reason: "not_found" as const,
        error: "Ese pedido no existe.",
      };
    }
    if (order.status === "CANCELLED") {
      return { ok: true as const, repeated: true as const };
    }
    if (order.status === "FULFILLED") {
      return {
        ok: false as const,
        reason: "invalid_state" as const,
        error:
          "Este pedido ya se entregó completo: no queda nada por cancelar. Si el cliente regresa algo, hazlo desde su venta.",
      };
    }
    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelledByUserId: userId,
        cancelledAt: new Date(),
        cancelReason: why,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "sales.order_cancelled",
      target: { type: "sales_order", id: order.id },
      reason: why,
      metadata: { pedido: String(order.number) },
    });
    return { ok: true as const };
  }, LOCKING_TRANSACTION);
}
