"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  findConfirmation,
  registerEntry,
  registerExit,
  registerInitialBalance,
  type EntryField,
} from "@/modules/inventory";
import { previewConversion, type Capture } from "@/platform/catalog";
import { requireOrganizationContext } from "@/platform/tenancy";

export type EntryFormState = {
  fieldErrors: Partial<Record<EntryField, string>>;
  formError?: string;
  values: {
    locationId: string;
    quantity: string;
    /** "base", "p:<presentation id>" or "u:<unit code>". */
    capture: string;
    reference: string;
    reason: string;
  };
};

/**
 * How the quantity is captured, as the form sends it. Only an id or a code
 * travels; the content of a presentation is always read in the server.
 */
function captureFields(capture: string): {
  presentationId?: string;
  unitCode?: string;
} {
  if (capture.startsWith("p:")) return { presentationId: capture.slice(2) };
  if (capture.startsWith("u:")) return { unitCode: capture.slice(2) };
  return {};
}

/**
 * Registers an entry. The product id is bound by the page and looked for
 * only inside the company of the session; person and company come from
 * the session, never from the form.
 */
export async function registerEntryAction(
  productId: string,
  prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  return receive("entry", productId, prev, formData);
}

/** Registers an exit; the service refuses more than the location holds (INV-19). */
export async function registerExitAction(
  productId: string,
  prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  return receive("exit", productId, prev, formData);
}

/** Registers the initial balance of a product in a location (INV-18). */
export async function registerInitialBalanceAction(
  productId: string,
  prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  return receive("initial", productId, prev, formData);
}

const SERVICES = {
  entry: registerEntry,
  exit: registerExit,
  initial: registerInitialBalance,
} as const;

async function receive(
  kind: keyof typeof SERVICES,
  productId: string,
  _prev: EntryFormState,
  formData: FormData,
): Promise<EntryFormState> {
  const { user, organization } = await requireOrganizationContext();
  const text = (name: string) => String(formData.get(name) ?? "");
  const values = {
    locationId: text("locationId"),
    quantity: text("quantity"),
    capture: text("capture") || "base",
    reference: text("reference"),
    reason: text("reason"),
  };
  let result;
  try {
    result = await SERVICES[kind](
      { organizationId: organization.id, userId: user.id },
      {
        productId: String(productId),
        locationId: values.locationId,
        quantity: values.quantity,
        reference: values.reference,
        reason: values.reason,
        // Created with the form and resent on every retry (INV-21).
        idempotencyKey: text("idempotencyKey"),
        ...captureFields(values.capture),
      },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { fieldErrors: {}, formError: error.message, values };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      // A problem with the product itself has no field in this form.
      formError: result.formError ?? result.fieldErrors.productId,
      values,
    };
  }
  revalidatePath("/movimientos");
  revalidatePath("/inventario");
  redirect(
    kind === "initial"
      ? `/movimientos/saldo-inicial?guardado=${result.movementId}`
      : `/movimientos?registrado=${result.movementId}`,
  );
}

export type EntryPreview =
  { ok: true; preview: string } | { ok: false; error: string };

/**
 * «3 cajas × 100 = 300 piezas», computed in the server with the current
 * content of the presentation, to show before confirming. Writes nothing.
 */
export async function previewEntryAction(
  productId: string,
  capture: string,
  quantity: string,
): Promise<EntryPreview> {
  const { user, organization } = await requireOrganizationContext();
  const fields = captureFields(String(capture));
  const typed = String(quantity).slice(0, 40);
  const request: Capture = fields.presentationId
    ? {
        kind: "presentation",
        quantity: typed,
        presentationId: fields.presentationId,
      }
    : fields.unitCode
      ? { kind: "unit", quantity: typed, unitCode: fields.unitCode }
      : { kind: "base", quantity: typed };
  try {
    const result = await previewConversion(
      { organizationId: organization.id, userId: user.id },
      String(productId),
      request,
    );
    return result.ok
      ? { ok: true, preview: result.preview }
      : { ok: false, error: result.error };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export type ConfirmationCheck = { registered: boolean; movementId?: string };

/**
 * Tells the form whether a confirmation whose answer never arrived was
 * registered (INV-22). It only reads; the key identifies a confirmation of
 * the person of the session.
 */
export async function checkConfirmationAction(
  idempotencyKey: string,
): Promise<ConfirmationCheck> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const found = await findConfirmation(
      { organizationId: organization.id, userId: user.id },
      String(idempotencyKey),
    );
    return found
      ? { registered: true, movementId: found.movementId }
      : { registered: false };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { registered: false };
    }
    throw error;
  }
}
