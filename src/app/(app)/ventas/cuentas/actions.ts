"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  findReceivablePaymentByKey,
  registerReceivablePayment,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";
import { requireOrganizationContext } from "@/platform/tenancy";

/**
 * Payments to an account (PAG-05). Person and company come from the
 * session; the account is locked only in that company and the payment
 * lands in the register of who receives it.
 */

export type PaymentFormState = {
  fieldErrors: Partial<
    Record<"amount" | "method" | "received" | "reference", string>
  >;
  formError?: string;
  values: {
    amount: string;
    method: string;
    received: string;
    reference: string;
  };
  answers: number;
};

const idPath = (value: string) =>
  String(value)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);

export async function registerPaymentAction(
  receivableId: string,
  prev: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  const { user, organization } = await requireOrganizationContext();
  const field = (name: string, max: number) =>
    String(formData.get(name) ?? "").slice(0, max);
  const values = {
    amount: field("amount", 20),
    method: field("method", 16),
    received: field("received", 20),
    reference: field("reference", 60),
  };
  const answers = prev.answers + 1;
  let result;
  try {
    result = await registerReceivablePayment(
      { organizationId: organization.id, userId: user.id },
      String(receivableId).slice(0, 36),
      {
        ...values,
        received: values.method === "CASH" ? values.received : "",
        reference: values.method === "CASH" ? "" : values.reference,
        idempotencyKey: field("idempotencyKey", 64),
      },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { fieldErrors: {}, formError: error.message, values, answers };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
      answers,
    };
  }
  revalidatePath(`/ventas/cuentas/${idPath(receivableId)}`);
  revalidatePath("/ventas/cuentas");
  redirect(
    `/ventas/cuentas/${idPath(receivableId)}?abono=${idPath(result.paymentId)}`,
  );
}

/** After a lost answer: this person's payment with that key, if any. */
export async function checkPaymentAction(
  key: string,
): Promise<{ paymentId: string; receivableId: string } | null> {
  const access = await getModuleAccess();
  if (!access.allows("sales.sale.create")) return null;
  return findReceivablePaymentByKey(
    { organizationId: access.organization.id, userId: access.user.id },
    String(key ?? ""),
  );
}
