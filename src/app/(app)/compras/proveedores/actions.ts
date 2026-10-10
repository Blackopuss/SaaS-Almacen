"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  createSupplier,
  updateSupplier,
  type SaveSupplierResult,
  type SupplierDuplicate,
  type SupplierField,
} from "@/platform/contacts";
import { requireOrganizationContext } from "@/platform/tenancy";

export type SupplierFormState = {
  fieldErrors: Partial<Record<SupplierField, string>>;
  formError?: string;
  /**
   * Contacts that look like this one: nothing was saved, and the person
   * decides whether to save it anyway.
   */
  duplicates?: SupplierDuplicate[];
  /** What the person had written, to show it again after a refusal. */
  values: Record<SupplierField, string>;
};

const FIELDS = [
  "name",
  "legalName",
  "rfc",
  "contactPerson",
  "email",
  "phone",
  "address",
  "notes",
] as const satisfies readonly SupplierField[];

function read(formData: FormData) {
  const values = Object.fromEntries(
    FIELDS.map((field) => [
      field,
      String(formData.get(field) ?? "").slice(0, 2000),
    ]),
  ) as Record<SupplierField, string>;
  // The person saw the likely duplicates and chose to save anyway.
  const acceptDuplicates = formData.get("acceptDuplicates") === "1";
  return { values, acceptDuplicates };
}

function refused(
  result: Extract<SaveSupplierResult, { ok: false }>,
  values: Record<SupplierField, string>,
): SupplierFormState {
  if (result.reason === "duplicate") {
    return { fieldErrors: {}, duplicates: result.duplicates, values };
  }
  return {
    fieldErrors: result.fieldErrors,
    formError: result.formError,
    values,
  };
}

/** Creates a supplier. Person and company come from the session. */
export async function createSupplierAction(
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const { user, organization } = await requireOrganizationContext();
  const { values, acceptDuplicates } = read(formData);
  let result;
  try {
    result = await createSupplier(
      { organizationId: organization.id, userId: user.id },
      values,
      { acceptDuplicates },
    );
  } catch (error) {
    // No permission, module missing or in read-only: say it in the form.
    if (isAppError(error) && error.kind === "forbidden") {
      return { fieldErrors: {}, formError: error.message, values };
    }
    throw error;
  }
  if (!result.ok) return refused(result, values);
  revalidatePath("/compras/proveedores");
  redirect(`/compras/proveedores/${result.supplierId}?guardado=nuevo`);
}

/**
 * Saves the card of a supplier. The id is bound by the page; the service
 * looks for it only among the suppliers of the company of the session.
 */
export async function updateSupplierAction(
  supplierId: string,
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const { user, organization } = await requireOrganizationContext();
  const { values, acceptDuplicates } = read(formData);
  let result;
  try {
    result = await updateSupplier(
      { organizationId: organization.id, userId: user.id },
      String(supplierId),
      values,
      { acceptDuplicates },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { fieldErrors: {}, formError: error.message, values };
    }
    throw error;
  }
  if (!result.ok) return refused(result, values);
  revalidatePath("/compras/proveedores");
  revalidatePath(`/compras/proveedores/${result.supplierId}`);
  redirect(`/compras/proveedores/${result.supplierId}?guardado=cambios`);
}
