"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import { cancelSale, findReturnByKey, returnSale } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";
import { requireOrganizationContext } from "@/platform/tenancy";

/**
 * Returns and cancellation of a sale (VEN-19..21). Person and company come
 * from the session; the sale is always looked for in that company, and
 * the service checks the permission again.
 */

export type ReturnFormState = {
  /** By sale line id. */
  lineErrors: Record<string, string>;
  fieldErrors: Partial<Record<"reason" | "refundMethod" | "reference", string>>;
  formError?: string;
  /** What was typed, kept when refused. */
  values: {
    quantities: Record<string, string>;
    reason: string;
    refundMethod: string;
    reference: string;
  };
  /** Answers so far: remounts the fields after an answer. */
  answers: number;
};

/** An id as it may go into an address: nothing but its own characters. */
const idPath = (value: string) =>
  String(value)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);

const field = (formData: FormData, name: string, max: number) =>
  String(formData.get(name) ?? "").slice(0, max);

function read(formData: FormData) {
  const quantities: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("q:") && Object.keys(quantities).length < 100) {
      quantities[name.slice(2, 38)] = String(value).slice(0, 40);
    }
  }
  return {
    quantities,
    reason: field(formData, "reason", 600),
    refundMethod: field(formData, "refundMethod", 10),
    reference: field(formData, "reference", 100),
  };
}

async function answer(
  saleId: string,
  prev: ReturnFormState,
  formData: FormData,
  cancel: boolean,
): Promise<ReturnFormState> {
  const { user, organization } = await requireOrganizationContext();
  const actor = { organizationId: organization.id, userId: user.id };
  const values = read(formData);
  const answers = prev.answers + 1;
  const common = {
    reason: values.reason,
    refundMethod: values.refundMethod,
    reference: values.reference,
    idempotencyKey: field(formData, "idempotencyKey", 64),
  };
  const id = String(saleId).slice(0, 36);
  let result;
  try {
    result = cancel
      ? await cancelSale(actor, id, common)
      : await returnSale(actor, id, {
          ...common,
          lines: Object.entries(values.quantities).map(
            ([saleLineId, quantity]) => ({ saleLineId, quantity }),
          ),
        });
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return {
        lineErrors: {},
        fieldErrors: {},
        formError: error.message,
        values,
        answers,
      };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      lineErrors: result.lineErrors,
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
      answers,
    };
  }
  revalidatePath(`/ventas/${id}`);
  revalidatePath("/ventas/caja");
  revalidatePath("/inventario");
  revalidatePath("/movimientos");
  // Back to the sale, which says what to give back.
  redirect(`/ventas/${idPath(id)}?devolucion=${idPath(result.returnId)}`);
}

/** Goods of a sale come back and their money goes back (VEN-19/20). */
export async function returnSaleAction(
  saleId: string,
  prev: ReturnFormState,
  formData: FormData,
): Promise<ReturnFormState> {
  return answer(saleId, prev, formData, false);
}

/** Cancels a sale: all that is left comes back (VEN-21). */
export async function cancelSaleAction(
  saleId: string,
  prev: ReturnFormState,
  formData: FormData,
): Promise<ReturnFormState> {
  return answer(saleId, prev, formData, true);
}

/** After a lost answer: whether this person's return with that key exists. */
export async function checkSaleReturnAction(
  key: string,
): Promise<{ saleId: string; returnId: string } | null> {
  const access = await getModuleAccess();
  if (!access.allows("sales.sale.read")) return null;
  const found = await findReturnByKey(
    { organizationId: access.organization.id, userId: access.user.id },
    String(key ?? ""),
  );
  return found ? { saleId: found.saleId, returnId: found.returnId } : null;
}
