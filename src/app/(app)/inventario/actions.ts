"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import { createProduct, type ProductField } from "@/platform/catalog";
import { requireOrganizationContext } from "@/platform/tenancy";

export type ProductFormState = {
  fieldErrors: Partial<Record<ProductField, string>>;
  formError?: string;
  values: Record<ProductField, string>;
};

/** Creates a product. Person and company come from the session. */
export async function createProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const { user, organization } = await requireOrganizationContext();
  const value = (name: ProductField) => String(formData.get(name) ?? "");
  const values = {
    sku: value("sku"),
    name: value("name"),
    description: value("description"),
    category: value("category"),
    brand: value("brand"),
    barcode: value("barcode"),
  };

  let result;
  try {
    result = await createProduct(
      { organizationId: organization.id, userId: user.id },
      values,
    );
  } catch (error) {
    // No permission, module missing or in read-only: say it in the form.
    if (isAppError(error) && error.kind === "forbidden") {
      return { fieldErrors: {}, formError: error.message, values };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
    };
  }
  revalidatePath("/inventario");
  redirect(`/inventario?creado=${encodeURIComponent(values.sku.trim())}`);
}
