"use server";

import { revalidatePath } from "next/cache";

import { isAppError } from "@/lib";
import { updateSalesSettings } from "@/modules/sales";
import { requireOrganizationContext } from "@/platform/tenancy";

export type SalesSettingsFormState = {
  fieldErrors: Partial<Record<"taxMode" | "taxRate", string>>;
  formError?: string;
  saved?: boolean;
  values: { taxMode: string; taxRate: string };
  /** Answers so far: remounts the radios with what was chosen. */
  answers: number;
};

/**
 * Saves how the company charges VAT (VEN-04). Only the titular: the
 * service checks it; person and company come from the session.
 */
export async function updateSalesSettingsAction(
  prev: SalesSettingsFormState,
  formData: FormData,
): Promise<SalesSettingsFormState> {
  const { user, organization } = await requireOrganizationContext();
  const values = {
    taxMode: String(formData.get("taxMode") ?? ""),
    taxRate: String(formData.get("taxRate") ?? ""),
  };
  const answers = prev.answers + 1;
  let result;
  try {
    result = await updateSalesSettings(
      { organizationId: organization.id, userId: user.id },
      values,
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { fieldErrors: {}, formError: error.message, values, answers };
    }
    throw error;
  }
  if (!result.ok) {
    return { fieldErrors: result.fieldErrors, values, answers };
  }
  revalidatePath("/configuracion/ventas");
  return { fieldErrors: {}, saved: true, values, answers };
}
