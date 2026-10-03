"use server";

import { redirect } from "next/navigation";

import {
  DEFAULT_AFTER_SIGN_IN,
  MFA_SETUP_PATH,
  requireSession,
} from "@/platform/auth";
import { createOrganization, type OrganizationField } from "@/platform/tenancy";

export type CreateOrganizationState = {
  fieldErrors: Partial<Record<OrganizationField, string>>;
  formError?: string;
  values: { name: string; timeZone: string };
};

export async function createOrganizationAction(
  _prev: CreateOrganizationState,
  formData: FormData,
): Promise<CreateOrganizationState> {
  const { user, mfaEnabled } = await requireSession();
  const values = {
    name: String(formData.get("name") ?? ""),
    timeZone: String(formData.get("timeZone") ?? ""),
  };
  const result = await createOrganization(user.id, values);
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
    };
  }
  // The new titular must set up MFA before using the app (PLT-08B).
  redirect(mfaEnabled ? DEFAULT_AFTER_SIGN_IN : MFA_SETUP_PATH);
}
