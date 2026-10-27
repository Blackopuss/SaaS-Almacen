"use server";

import { revalidatePath } from "next/cache";

import { isAppError } from "@/lib";
import { updateSalesSettings, type SalesSettingsField } from "@/modules/sales";
import { requireOrganizationContext } from "@/platform/tenancy";

export type SalesSettingsFormState = {
  fieldErrors: Partial<Record<SalesSettingsField, string>>;
  formError?: string;
  saved?: boolean;
  values: {
    taxMode: string;
    taxRate: string;
    cashier: string;
    cash_manager: string;
    administrator: string;
  };
  /** Answers so far: remounts the radios with what was chosen. */
  answers: number;
};

/**
 * Saves how the company charges VAT (VEN-04) and the discount cap of each
 * role (VEN-14). Only the titular: the service checks it; person and
 * company come from the session.
 */
export async function updateSalesSettingsAction(
  prev: SalesSettingsFormState,
  formData: FormData,
): Promise<SalesSettingsFormState> {
  const { user, organization } = await requireOrganizationContext();
  const field = (name: string) => String(formData.get(name) ?? "").slice(0, 16);
  const values = {
    taxMode: field("taxMode"),
    taxRate: field("taxRate"),
    cashier: field("cap.cashier"),
    cash_manager: field("cap.cash_manager"),
    administrator: field("cap.administrator"),
  };
  const answers = prev.answers + 1;
  let result;
  try {
    result = await updateSalesSettings(
      { organizationId: organization.id, userId: user.id },
      {
        taxMode: values.taxMode,
        taxRate: values.taxRate,
        caps: {
          cashier: values.cashier,
          cash_manager: values.cash_manager,
          administrator: values.administrator,
        },
      },
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
