"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import { cancelSalesOrder } from "@/modules/sales";
import { requireOrganizationContext } from "@/platform/tenancy";

/**
 * Cancelling an order (COT-09). Person and company come from the session;
 * the order is locked only in that company; the service checks the
 * permission and the state.
 */

export type CancelOrderState = {
  error?: string;
  reason: string;
  answers: number;
};

const idPath = (value: string) =>
  String(value)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);

export async function cancelOrderAction(
  orderId: string,
  prev: CancelOrderState,
  formData: FormData,
): Promise<CancelOrderState> {
  const { user, organization } = await requireOrganizationContext();
  const reason = String(formData.get("reason") ?? "").slice(0, 600);
  const answers = prev.answers + 1;
  let result;
  try {
    result = await cancelSalesOrder(
      { organizationId: organization.id, userId: user.id },
      String(orderId).slice(0, 36),
      reason,
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { error: error.message, reason, answers };
    }
    throw error;
  }
  if (!result.ok) return { error: result.error, reason, answers };
  revalidatePath("/ventas/pedidos");
  revalidatePath(`/ventas/pedidos/${idPath(orderId)}`);
  redirect(`/ventas/pedidos/${idPath(orderId)}`);
}
