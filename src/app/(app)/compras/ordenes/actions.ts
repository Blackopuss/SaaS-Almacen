"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  addOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  removeOrderLine,
  submitPurchaseOrder,
  updateOrderLine,
  updatePurchaseOrder,
  type OrderField,
} from "@/modules/purchasing";
import { requireOrganizationContext } from "@/platform/tenancy";

/** An id as it may go into an address: nothing but its own characters. */
const idPath = (value: string) =>
  String(value)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);

export type OrderFormState = {
  fieldErrors: Partial<Record<OrderField, string>>;
  formError?: string;
  /** What the person had written, to show it again after a refusal. */
  values: { supplierId: string; expectedOn: string; notes: string };
  /** Changes with every answer, so selects show what was chosen. */
  answers: number;
};

const header = (formData: FormData) => ({
  supplierId: String(formData.get("supplierId") ?? "").slice(0, 36),
  expectedOn: String(formData.get("expectedOn") ?? "").slice(0, 10),
  notes: String(formData.get("notes") ?? "").slice(0, 2000),
});

/** Starts a purchase order. Person and company come from the session. */
export async function createPurchaseOrderAction(
  prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const { user, organization } = await requireOrganizationContext();
  const values = header(formData);
  const answers = prev.answers + 1;
  let result;
  try {
    result = await createPurchaseOrder(
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
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
      answers,
    };
  }
  revalidatePath("/compras");
  redirect(`/compras/ordenes/${result.orderId}`);
}

/**
 * Saves the expected day and the notes of a draft. The order is looked
 * for only inside the company of the session.
 */
export async function updatePurchaseOrderAction(
  orderId: string,
  prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const { user, organization } = await requireOrganizationContext();
  const values = header(formData);
  const answers = prev.answers + 1;
  let result;
  try {
    result = await updatePurchaseOrder(
      { organizationId: organization.id, userId: user.id },
      String(orderId),
      { expectedOn: values.expectedOn, notes: values.notes },
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
  revalidatePath(`/compras/ordenes/${idPath(orderId)}`);
  redirect(`/compras/ordenes/${idPath(orderId)}`);
}

export type LineFormState = {
  fieldErrors: Partial<Record<OrderField, string>>;
  formError?: string;
  values: { capture: string; quantity: string; unitCost: string };
  answers: number;
};

/**
 * What the form of a line sent. The cost travels only when the form had
 * its field — the page shows it only to who may record costs — so a
 * person without that permission never erases a cost by saving.
 */
const lineOf = (formData: FormData) => {
  const values = {
    capture: String(formData.get("capture") ?? "base").slice(0, 40),
    quantity: String(formData.get("quantity") ?? "").slice(0, 40),
    unitCost: String(formData.get("unitCost") ?? "").slice(0, 40),
  };
  return {
    values,
    input: {
      capture: values.capture,
      quantity: values.quantity,
      ...(formData.has("unitCost") ? { unitCost: values.unitCost } : {}),
    },
  };
};

/**
 * Adds a product to a draft. Order and product are bound by the page; the
 * service looks for both only inside the company of the session.
 */
export async function addOrderLineAction(
  orderId: string,
  productId: string,
  prev: LineFormState,
  formData: FormData,
): Promise<LineFormState> {
  const { user, organization } = await requireOrganizationContext();
  const { values, input } = lineOf(formData);
  const answers = prev.answers + 1;
  let result;
  try {
    result = await addOrderLine(
      { organizationId: organization.id, userId: user.id },
      String(orderId),
      { productId: String(productId), ...input },
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
      formError: result.formError ?? result.fieldErrors.productId,
      values,
      answers,
    };
  }
  revalidatePath(`/compras/ordenes/${idPath(orderId)}`);
  redirect(`/compras/ordenes/${idPath(orderId)}`);
}

/** Changes a line of a draft; looked for only inside the company of the session. */
export async function updateOrderLineAction(
  orderId: string,
  lineId: string,
  prev: LineFormState,
  formData: FormData,
): Promise<LineFormState> {
  const { user, organization } = await requireOrganizationContext();
  const { values, input } = lineOf(formData);
  const answers = prev.answers + 1;
  let result;
  try {
    result = await updateOrderLine(
      { organizationId: organization.id, userId: user.id },
      String(lineId),
      input,
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
  revalidatePath(`/compras/ordenes/${idPath(orderId)}`);
  redirect(`/compras/ordenes/${idPath(orderId)}`);
}

export type RemoveLineState = { ok: true } | { ok: false; error: string };

/** Takes a line out of a draft; looked for only inside the company of the session. */
export async function removeOrderLineAction(
  orderId: string,
  lineId: string,
): Promise<RemoveLineState> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await removeOrderLine(
      { organizationId: organization.id, userId: user.id },
      String(lineId),
    );
    if (!result.ok) {
      return {
        ok: false,
        error: result.formError ?? "No se pudo quitar la línea.",
      };
    }
    revalidatePath(`/compras/ordenes/${idPath(orderId)}`);
    return { ok: true };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export type OrderStateActionResult =
  { ok: true; message: string } | { ok: false; error: string };

/**
 * Confirms a draft as sent (CMP-05). The order is looked for only inside
 * the company of the session; sending it twice confirms once.
 */
export async function submitPurchaseOrderAction(
  orderId: string,
): Promise<OrderStateActionResult> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await submitPurchaseOrder(
      { organizationId: organization.id, userId: user.id },
      String(orderId),
    );
    if (!result.ok) {
      return {
        ok: false,
        error: result.formError ?? "No se pudo confirmar la orden.",
      };
    }
    revalidatePath("/compras");
    revalidatePath(`/compras/ordenes/${idPath(orderId)}`);
    return { ok: true, message: "Orden confirmada como enviada." };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/**
 * Cancels an order with its reason (CMP-05). Looked for only inside the
 * company of the session; cancelling twice cancels once.
 */
export async function cancelPurchaseOrderAction(
  orderId: string,
  reason: string,
): Promise<OrderStateActionResult> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await cancelPurchaseOrder(
      { organizationId: organization.id, userId: user.id },
      String(orderId),
      { reason: String(reason ?? "").slice(0, 1000) },
    );
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.fieldErrors.reason ??
          result.formError ??
          "No se pudo cancelar la orden.",
      };
    }
    revalidatePath("/compras");
    revalidatePath(`/compras/ordenes/${idPath(orderId)}`);
    return { ok: true, message: "Orden cancelada." };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
