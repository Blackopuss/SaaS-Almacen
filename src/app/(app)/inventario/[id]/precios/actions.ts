"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import { setSalePrices } from "@/modules/sales";
import { requireOrganizationContext } from "@/platform/tenancy";

export type PricesFormState = {
  fieldErrors: Record<string, string>;
  formError?: string;
  /** What was typed, by field ("unit" or a presentation id). */
  values: Record<string, string>;
};

/**
 * Saves the sale prices of a product (VEN-03). The product id is bound by
 * the page; person and company come from the session.
 */
export async function setSalePricesAction(
  productId: string,
  _prev: PricesFormState,
  formData: FormData,
): Promise<PricesFormState> {
  const { user, organization } = await requireOrganizationContext();
  const values: Record<string, string> = {};
  const presentations: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (name === "unit") values.unit = value;
    else if (name.startsWith("p:")) {
      values[name.slice(2)] = value;
      presentations[name.slice(2)] = value;
    }
  }
  let result;
  try {
    result = await setSalePrices(
      { organizationId: organization.id, userId: user.id },
      String(productId),
      { unitPrice: values.unit ?? "", presentations },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { fieldErrors: {}, formError: error.message, values };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
    };
  }
  const id = String(productId)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);
  revalidatePath(`/inventario/${id}`);
  redirect(`/inventario/${id}`);
}
