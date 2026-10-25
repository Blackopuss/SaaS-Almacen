"use server";

import { revalidatePath } from "next/cache";

import {
  createPromoCode,
  disablePromoCode,
  requirePlatformStaff,
  type PromoCodeField,
  type PromoCodeInput,
} from "@/platform/billing";

export type PromoCodeState = {
  fieldErrors: Partial<Record<PromoCodeField, string>>;
  formError?: string;
  /** The code just created. */
  created?: string;
  /** What was typed, so a rejected form keeps it. */
  values?: PromoCodeInput;
};

/** Creates a discount code (ADR 0028). Staff from the session; the service checks again. */
export async function createPromoCodeAction(
  _prev: PromoCodeState,
  formData: FormData,
): Promise<PromoCodeState> {
  const staff = await requirePlatformStaff();
  const values: PromoCodeInput = {
    code: String(formData.get("code") ?? ""),
    percentOff: String(formData.get("percentOff") ?? ""),
    maxRedemptions: String(formData.get("maxRedemptions") ?? ""),
    validUntil: String(formData.get("validUntil") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
  const result = await createPromoCode(staff.userId, values);
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
    };
  }
  revalidatePath("/interno/codigos");
  return { fieldErrors: {}, created: result.code };
}

/** Turns a code off for good. */
export async function disablePromoCodeAction(
  promoCodeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await requirePlatformStaff();
  const result = await disablePromoCode(staff.userId, String(promoCodeId));
  if (!result.ok) return { ok: false, error: result.formError };
  revalidatePath("/interno/codigos");
  return { ok: true };
}
