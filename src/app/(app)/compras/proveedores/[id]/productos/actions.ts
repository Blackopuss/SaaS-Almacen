"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  linkProductSupplier,
  updateProductSupplier,
  type ProductSupplierField,
} from "@/modules/purchasing";
import { requireOrganizationContext } from "@/platform/tenancy";

export type LinkFormState = {
  fieldErrors: Partial<Record<ProductSupplierField, string>>;
  formError?: string;
  /** What the person had written, to show it again after a refusal. */
  values: { supplierSku: string; presentationId: string };
  /** Changes with every answer, so the select shows what was chosen. */
  answers: number;
};

/** An id as it may go into an address: nothing but its own characters. */
const idPath = (value: string) =>
  String(value)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);

const read = (formData: FormData) => ({
  supplierSku: String(formData.get("supplierSku") ?? "").slice(0, 200),
  presentationId: String(formData.get("presentationId") ?? "").slice(0, 36),
});

/**
 * Links a product with a supplier (CMP-03). Supplier and product are
 * bound by the page; the service looks for both only inside the company
 * of the session, so an id of another company links nothing.
 */
export async function linkProductSupplierAction(
  supplierId: string,
  productId: string,
  prev: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const { user, organization } = await requireOrganizationContext();
  const values = read(formData);
  const answers = prev.answers + 1;
  let result;
  try {
    result = await linkProductSupplier(
      { organizationId: organization.id, userId: user.id },
      {
        supplierId: String(supplierId),
        productId: String(productId),
        ...values,
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
      // A problem with the product or the supplier has no field here.
      formError:
        result.formError ??
        result.fieldErrors.productId ??
        result.fieldErrors.supplierId,
      values,
      answers,
    };
  }
  revalidatePath(`/compras/proveedores/${idPath(supplierId)}`);
  redirect(`/compras/proveedores/${idPath(supplierId)}?guardado=vinculo`);
}

/**
 * Saves the supplier's code and the presentation of purchase of a link.
 * The link is looked for only inside the company of the session.
 */
export async function updateProductSupplierAction(
  supplierId: string,
  linkId: string,
  prev: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const { user, organization } = await requireOrganizationContext();
  const values = read(formData);
  const answers = prev.answers + 1;
  let result;
  try {
    result = await updateProductSupplier(
      { organizationId: organization.id, userId: user.id },
      String(linkId),
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
  revalidatePath(`/compras/proveedores/${idPath(supplierId)}`);
  redirect(`/compras/proveedores/${idPath(supplierId)}?guardado=vinculo`);
}
