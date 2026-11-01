"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  closeCashSession,
  openCashSession,
  recordCashMovement,
} from "@/modules/sales";
import { requireOrganizationContext } from "@/platform/tenancy";

/**
 * The cash register (VEN-16..18). Person and company come from the
 * session; a register is always looked for in that company.
 */

export type CashFormState = {
  fieldErrors: Partial<Record<string, string>>;
  formError?: string;
  saved?: boolean;
  /** What was typed, kept when refused. */
  values: Record<string, string>;
  /** Answers so far: remounts the fields after an answer. */
  answers: number;
};

async function actor() {
  const { user, organization } = await requireOrganizationContext();
  return { organizationId: organization.id, userId: user.id };
}

const field = (formData: FormData, name: string, max = 200) =>
  String(formData.get(name) ?? "").slice(0, max);

function refused(
  error: unknown,
  values: Record<string, string>,
  answers: number,
): CashFormState {
  if (isAppError(error) && error.kind === "forbidden") {
    return { fieldErrors: {}, formError: error.message, values, answers };
  }
  throw error;
}

/** Opens this person's register with its float. */
export async function openCashAction(
  prev: CashFormState,
  formData: FormData,
): Promise<CashFormState> {
  const values = { openingFloat: field(formData, "openingFloat", 20) };
  const answers = prev.answers + 1;
  let result;
  try {
    result = await openCashSession(await actor(), values);
  } catch (error) {
    return refused(error, values, answers);
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
      answers,
    };
  }
  revalidatePath("/ventas");
  redirect("/ventas");
}

/** Money put into or taken out of this person's open register. */
export async function cashMovementAction(
  prev: CashFormState,
  formData: FormData,
): Promise<CashFormState> {
  const values = {
    direction: field(formData, "direction", 3),
    amount: field(formData, "amount", 20),
    reason: field(formData, "reason", 300),
  };
  const answers = prev.answers + 1;
  let result;
  try {
    result = await recordCashMovement(await actor(), values);
  } catch (error) {
    return refused(error, values, answers);
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
      answers,
    };
  }
  revalidatePath("/ventas/caja");
  return {
    fieldErrors: {},
    saved: true,
    values: { direction: values.direction },
    answers,
  };
}

/** The close of a register: what was counted, by method. */
export async function closeCashAction(
  sessionId: string,
  prev: CashFormState,
  formData: FormData,
): Promise<CashFormState> {
  const values = {
    countedCash: field(formData, "countedCash", 20),
    countedCard: field(formData, "countedCard", 20),
    countedTransfer: field(formData, "countedTransfer", 20),
    note: field(formData, "note", 600),
  };
  const answers = prev.answers + 1;
  let result;
  try {
    result = await closeCashSession(await actor(), String(sessionId), values);
  } catch (error) {
    return refused(error, values, answers);
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
      answers,
    };
  }
  revalidatePath("/ventas/caja");
  revalidatePath(`/ventas/caja/${result.sessionId}`);
  return { fieldErrors: {}, saved: true, values, answers };
}
