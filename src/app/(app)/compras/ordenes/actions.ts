"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  addOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  findReceiptConfirmation,
  receivePurchaseOrder,
  removeOrderLine,
  requestOrderDelivery,
  submitPurchaseOrder,
  updateOrderLine,
  updatePurchaseOrder,
  type OrderField,
  type ReceiveField,
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

/**
 * Asks to send an order to its supplier by mail, or to try again after a
 * failure (CMP-06B). The order is looked for only inside the company of
 * the session and the address is the supplier's, never one sent by the
 * browser. The worker sends it.
 */
export async function sendPurchaseOrderAction(
  orderId: string,
): Promise<OrderStateActionResult> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await requestOrderDelivery(
      { organizationId: organization.id, userId: user.id },
      String(orderId),
    );
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath(`/compras/ordenes/${idPath(orderId)}`);
    return {
      ok: true,
      message: result.repeated
        ? `Ya hay un envío en camino a ${result.recipient}.`
        : `La orden va en camino a ${result.recipient}.`,
    };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export type ReceiveFormState = {
  fieldErrors: Partial<Record<ReceiveField, string>>;
  formError?: string;
  /** Problem of each line, by the id of the order line. */
  lineErrors?: Record<string, string>;
  values: {
    locationId: string;
    reference: string;
    /** What was typed for each line, by the id of the order line. */
    quantities: Record<string, string>;
    /** Location chosen for a line, when not the one of the receipt. */
    places: Record<string, string>;
  };
  /** Changes with every answer, so selects show what was chosen. */
  answers: number;
  /** The receipt went through: what to tell the person. */
  done?: string;
};

/**
 * Receives what is pending of an order into one location (CMP-07). The
 * order and the location are looked for only inside the company of the
 * session; the key makes a repeated confirmation receive once.
 */
export async function receivePurchaseOrderAction(
  orderId: string,
  prev: ReceiveFormState,
  formData: FormData,
): Promise<ReceiveFormState> {
  const { user, organization } = await requireOrganizationContext();
  // One field per line of the order: `q:<id of the order line>`.
  // and, when it goes elsewhere than the rest, `l:<id>` (CMP-09).
  const quantities: Record<string, string> = {};
  const places: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (name.startsWith("q:") && Object.keys(quantities).length < 200) {
      quantities[name.slice(2, 38)] = value.slice(0, 40);
    } else if (
      name.startsWith("l:") &&
      value &&
      Object.keys(places).length < 200
    ) {
      places[name.slice(2, 38)] = value.slice(0, 36);
    }
  }
  const values = {
    locationId: String(formData.get("locationId") ?? "").slice(0, 36),
    reference: String(formData.get("reference") ?? "").slice(0, 200),
    quantities,
    places,
  };
  const answers = prev.answers + 1;
  let result;
  try {
    result = await receivePurchaseOrder(
      { organizationId: organization.id, userId: user.id },
      String(orderId),
      {
        locationId: values.locationId,
        reference: values.reference,
        lines: Object.entries(quantities).map(([orderLineId, quantity]) => ({
          orderLineId,
          quantity,
          locationId: places[orderLineId],
        })),
        idempotencyKey: String(formData.get("idempotencyKey") ?? "").slice(
          0,
          64,
        ),
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
      lineErrors: result.lineErrors,
      values,
      answers,
    };
  }
  revalidatePath("/compras");
  revalidatePath(`/compras/ordenes/${idPath(orderId)}`);
  return { fieldErrors: {}, values, answers, done: result.summary };
}

/**
 * After a lost answer (INV-22): whether the receipt with that key was
 * registered for this person in the company of the session.
 */
export async function checkReceiptAction(
  idempotencyKey: string,
): Promise<{ received: boolean }> {
  const { user, organization } = await requireOrganizationContext();
  const found = await findReceiptConfirmation(
    { organizationId: organization.id, userId: user.id },
    String(idempotencyKey ?? "").slice(0, 64),
  );
  return { received: found !== null };
}
