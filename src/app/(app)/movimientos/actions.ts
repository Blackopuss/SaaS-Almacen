"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import { registerEntry, type EntryField } from "@/modules/inventory";
import { requireOrganizationContext } from "@/platform/tenancy";

export type EntryFormState = {
  fieldErrors: Partial<Record<EntryField, string>>;
  formError?: string;
  values: {
    locationId: string;
    quantity: string;
    reference: string;
    reason: string;
  };
};

/**
 * Registers an entry. The product id is bound by the page and looked for
 * only inside the company of the session; person and company come from
 * the session, never from the form.
 */
export async function registerEntryAction(
  productId: string,
  _prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const { user, organization } = await requireOrganizationContext();
  const text = (name: string) => String(formData.get(name) ?? "");
  const values = {
    locationId: text("locationId"),
    quantity: text("quantity"),
    reference: text("reference"),
    reason: text("reason"),
  };
  let result;
  try {
    result = await registerEntry(
      { organizationId: organization.id, userId: user.id },
      { productId: String(productId), ...values },
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
      // A problem with the product itself has no field in this form.
      formError: result.formError ?? result.fieldErrors.productId,
      values,
    };
  }
  revalidatePath("/movimientos");
  revalidatePath("/inventario");
  redirect(`/movimientos?entrada=${result.movementId}`);
}
