"use server";

import { revalidatePath } from "next/cache";

import { isAppError } from "@/lib";
import { requestStatementDelivery } from "@/modules/sales";
import { requireOrganizationContext } from "@/platform/tenancy";

/**
 * Mails a customer their statement (PAG-06). The address is the one of the
 * customer's card, never one sent from here; the customer is looked for
 * in the company of the session.
 */
export async function sendStatementAction(
  customerId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { user, organization } = await requireOrganizationContext();
  const id = String(customerId)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);
  try {
    const result = await requestStatementDelivery(
      { organizationId: organization.id, userId: user.id },
      id,
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath(`/ventas/cuentas/cliente/${id}`);
    return {
      ok: true,
      message: result.repeated
        ? `Ya hay un envío en camino a ${result.recipient}.`
        : `El estado de cuenta va en camino a ${result.recipient}.`,
    };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
