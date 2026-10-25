"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAccess } from "@/platform/authorization";
import {
  previewCode,
  startCheckout,
  type CheckoutField,
} from "@/platform/billing";

import { quoteTable, type ShownQuote } from "./quotes";

export type CheckoutValues = {
  tier: string;
  months: string;
  purchasing: boolean;
  code: string;
};

export type CheckoutState = {
  fieldErrors: Partial<Record<CheckoutField, string>>;
  formError?: string;
  /** What was chosen, so a rejected form keeps it (React resets forms). */
  values?: CheckoutValues;
  /** A code that applies: its discount priced for every combination. */
  applied?: {
    code: string;
    percentOff: number;
    quotes: Record<string, ShownQuote>;
  };
  /** Counts answers: remounts the choices with the values above. */
  answers: number;
};

/**
 * «Aplicar» a code (`intent=apply`) or pay (any other submit). The actor
 * and the email for the receipt come from the session; the service checks
 * the titular and prices everything again.
 */
export async function checkoutAction(
  prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const access = await getAccess();
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const values: CheckoutValues = {
    tier: String(formData.get("tier") ?? ""),
    months: String(formData.get("months") ?? ""),
    purchasing: formData.get("purchasing") === "1",
    code: String(formData.get("code") ?? ""),
  };
  const answers = prev.answers + 1;

  if (formData.get("intent") === "apply") {
    const result = await previewCode(actor, values, await headers());
    if (!result.ok) {
      return {
        fieldErrors: result.fieldErrors,
        formError: result.formError,
        values,
        answers,
      };
    }
    return {
      fieldErrors: {},
      values: { ...values, code: result.code },
      applied: {
        code: result.code,
        percentOff: result.percentOff,
        quotes: quoteTable(result.percentOff),
      },
      answers,
    };
  }

  const result = await startCheckout(
    actor,
    { ...values, provider: String(formData.get("provider") ?? "") },
    await headers(),
    access.user.email,
  );
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
      // The code was not the problem: keep showing its discount.
      applied: result.fieldErrors.code ? undefined : prev.applied,
      answers,
    };
  }
  redirect(result.next);
}
