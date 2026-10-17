"use server";

import { revalidatePath } from "next/cache";

import { isAppError } from "@/lib";
import { setMinimum } from "@/modules/inventory";
import { requireOrganizationContext } from "@/platform/tenancy";

export type MinimumFormState = {
  error?: string;
  /** «Mínimo de Tornillo: 20 piezas.» after a change that went through. */
  saved?: string;
  /** What the box shows: what was typed, or what was stored. */
  value: string;
};

/**
 * Sets or removes (empty) the minimum of a product (INV-30). The product
 * id is bound by the page and looked for only inside the company of the
 * session; person and company come from the session.
 */
export async function setMinimumAction(
  productId: string,
  _prev: MinimumFormState,
  formData: FormData,
): Promise<MinimumFormState> {
  const { user, organization } = await requireOrganizationContext();
  const value = String(formData.get("minimum") ?? "").slice(0, 40);
  let result;
  try {
    result = await setMinimum(
      { organizationId: organization.id, userId: user.id },
      { productId: String(productId), quantity: value },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { error: error.message, value };
    }
    throw error;
  }
  if (!result.ok) return { error: result.error, value };
  revalidatePath("/inventario");
  return { saved: result.summary, value: result.minimum ?? "" };
}
