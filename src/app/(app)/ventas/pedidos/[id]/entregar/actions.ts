"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  fulfillSalesOrder,
  previewFulfillment,
  type FulfillmentPreview,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";
import { requireOrganizationContext } from "@/platform/tenancy";

import { readPaymentFields } from "../../../payment-fields";

/**
 * Delivering and charging an order (COT-08). Person and company come from
 * the session; the order is looked for in that company. The browser sends
 * ids and what was typed; prices and totals come from the service.
 */

const MAX_LINES = 100;

/** The lines as the form sends them: ids and what was typed, cut short. */
function readLines(lines: unknown) {
  const sent = Array.isArray(lines) ? lines.slice(0, MAX_LINES) : [];
  return sent.map((line) => {
    const fields =
      line && typeof line === "object" ? (line as Record<string, unknown>) : {};
    const field = (name: string) =>
      typeof fields[name] === "string" ? fields[name].slice(0, 40) : "";
    return {
      orderLineId: field("orderLineId"),
      quantity: field("quantity"),
      locationId: field("locationId"),
    };
  });
}

/** What the delivery adds up to, computed here; never in the browser. */
export async function previewFulfillmentAction(
  orderId: string,
  lines: unknown,
  payments: unknown,
): Promise<FulfillmentPreview | { error: string }> {
  const access = await getModuleAccess();
  if (!access.allows("sales.sale.create")) {
    return { error: "No tienes permiso para cobrar." };
  }
  const preview = await previewFulfillment(
    { organizationId: access.organization.id, userId: access.user.id },
    String(orderId).slice(0, 36),
    { lines: readLines(lines), payments: readPaymentFields(payments) },
  );
  return preview ?? { error: "Este pedido ya no está por surtir." };
}

export type FulfillFormState = {
  /** By id of the order's line. */
  lineErrors: Record<string, string>;
  /** By position of the payment sent. */
  paymentErrors: Record<number, string>;
  formError?: string;
};

/** An id as it may go into an address: nothing but its own characters. */
const idPath = (value: string) =>
  String(value)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);

/** Delivers what was typed and charges it; then opens its ticket. */
export async function fulfillOrderAction(
  orderId: string,
  _prev: FulfillFormState,
  formData: FormData,
): Promise<FulfillFormState> {
  const { user, organization } = await requireOrganizationContext();
  const json = (name: string): unknown => {
    try {
      return JSON.parse(String(formData.get(name) ?? "").slice(0, 60_000));
    } catch {
      return [];
    }
  };
  let result;
  try {
    result = await fulfillSalesOrder(
      { organizationId: organization.id, userId: user.id },
      String(orderId).slice(0, 36),
      {
        lines: readLines(json("lines")),
        payments: readPaymentFields(json("payments")),
        idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { lineErrors: {}, paymentErrors: {}, formError: error.message };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      lineErrors: result.lineErrors,
      paymentErrors: result.paymentErrors,
      formError: result.formError,
    };
  }
  revalidatePath(`/ventas/pedidos/${idPath(orderId)}`);
  revalidatePath("/ventas/pedidos");
  revalidatePath("/inventario");
  revalidatePath("/movimientos");
  redirect(`/ventas/${idPath(result.saleId)}?entrega=1`);
}
