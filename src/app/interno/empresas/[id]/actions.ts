"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { moduleOpenWork, moduleRegistry } from "@/modules/registry";
import { requireSession } from "@/platform/auth";
import { enterSupport } from "@/platform/authorization";
import {
  provisionCompany,
  recordManualPayment,
  requirePlatformStaff,
  reverseManualPayment,
  type PaymentField,
  type PaymentInput,
  type ProvisionField,
} from "@/platform/billing";

export type ProvisionState = {
  fieldErrors: Partial<Record<ProvisionField, string>>;
  formError?: string;
  saved?: boolean;
  /** Modules being removed with work halfway (CMP-17). */
  openWork?: { module: string; lines: string[] }[];
  /** What was typed, so a rejected form keeps it (React resets forms). */
  values?: { modules: string[]; validUntil: string; reason: string };
};

/** End of the chosen day in central Mexico (UTC-6, no daylight saving). */
function endOfDay(value: string): Date | null | "invalid" {
  if (value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "invalid";
  const date = new Date(`${value}T23:59:59.999-06:00`);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

/**
 * Assigns the plan of a company. The staff member comes from the session;
 * the company id is the one bound by the page, never trusted on its own:
 * the service checks that the caller is platform staff.
 */
export async function provisionAction(
  organizationId: string,
  _prev: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const staff = await requirePlatformStaff();
  const values = {
    modules: formData.getAll("modules").map(String),
    validUntil: String(formData.get("validUntil") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  };
  const validUntil = endOfDay(values.validUntil);
  if (validUntil === "invalid") {
    return {
      fieldErrors: { validUntil: "Elige una fecha válida." },
      values,
    };
  }
  const result = await provisionCompany(
    moduleRegistry,
    staff.userId,
    String(organizationId),
    {
      productLimit: String(formData.get("productLimit") ?? ""),
      users: String(formData.get("users") ?? ""),
      modules: values.modules,
      validUntil,
      reason: values.reason,
    },
    {
      openWork: moduleOpenWork,
      acceptOpenWork: formData.get("acceptOpenWork") === "1",
    },
  );
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      openWork: result.openWork,
      values,
    };
  }
  revalidatePath(`/interno/empresas/${organizationId}`);
  return { fieldErrors: {}, saved: true };
}

export type PaymentState = {
  fieldErrors: Partial<Record<PaymentField, string>>;
  formError?: string;
  /** End of the plan after the payment, ISO. */
  savedUntil?: string;
  /** What was typed, so a rejected form keeps it. */
  values?: PaymentInput;
};

/**
 * Registers a SPEI payment (PIL-11). Staff from the session; the company
 * id is the one bound by the page and the service checks staff again.
 */
export async function recordPaymentAction(
  organizationId: string,
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const staff = await requirePlatformStaff();
  const values: PaymentInput = {
    amount: String(formData.get("amount") ?? ""),
    paidOn: String(formData.get("paidOn") ?? ""),
    reference: String(formData.get("reference") ?? ""),
    months: String(formData.get("months") ?? ""),
    notes: String(formData.get("notes") ?? ""),
  };
  const result = await recordManualPayment(
    staff.userId,
    String(organizationId),
    values,
  );
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
    };
  }
  revalidatePath(`/interno/empresas/${organizationId}`);
  return { fieldErrors: {}, savedUntil: result.validUntil.toISOString() };
}

export type ReversalState = {
  error?: string;
  /** What was typed, so a rejected form keeps it. */
  reason?: string;
  done?: boolean;
};

/** Reverses a payment registered by mistake (PIL-11). */
export async function reversePaymentAction(
  organizationId: string,
  paymentId: string,
  _prev: ReversalState,
  formData: FormData,
): Promise<ReversalState> {
  const staff = await requirePlatformStaff();
  const reason = String(formData.get("reason") ?? "");
  const result = await reverseManualPayment(
    staff.userId,
    String(organizationId),
    String(paymentId),
    reason,
  );
  if (!result.ok) {
    return {
      error: result.fieldErrors.notes ?? result.formError,
      reason,
    };
  }
  revalidatePath(`/interno/empresas/${organizationId}`);
  return { done: true };
}

/**
 * Platform staff enters a company as support (PIL-12): only while its
 * titular keeps the access open; the service checks staff and access.
 */
export async function enterSupportAction(
  organizationId: string,
): Promise<{ error: string }> {
  await requirePlatformStaff();
  const { user, sessionId } = await requireSession();
  const result = await enterSupport(user.id, sessionId, String(organizationId));
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect("/inicio");
}
