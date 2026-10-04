"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  archiveProduct,
  createPresentation,
  createProduct,
  reactivateProduct,
  updateProduct,
  type PresentationField,
  type ProductField,
  type ProductStatusResult,
} from "@/platform/catalog";
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
    unit: value("unit"),
    step: value("step"),
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

/** Saves the card of a product. The id is bound by the page; the service
 * looks for it only inside the company of the session. */
export async function updateProductAction(
  productId: string,
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
    unit: value("unit"),
    step: value("step"),
  };

  let result;
  try {
    result = await updateProduct(
      { organizationId: organization.id, userId: user.id },
      String(productId),
      values,
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
      formError: result.formError,
      values,
    };
  }
  revalidatePath("/inventario");
  redirect(`/inventario?guardado=${encodeURIComponent(values.sku.trim())}`);
}

type StatusActionResult = { ok: true } | { ok: false; error: string };

/** Runs a status change and turns "not allowed" into a message. */
async function statusChange(
  change: (actor: {
    organizationId: string;
    userId: string;
  }) => Promise<ProductStatusResult>,
): Promise<StatusActionResult> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await change({
      organizationId: organization.id,
      userId: user.id,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** Archives a product and goes back to the catalog; returns only a refusal. */
export async function archiveProductAction(
  productId: string,
  reason: string,
): Promise<StatusActionResult | undefined> {
  const result = await statusChange((actor) =>
    archiveProduct(actor, String(productId), String(reason ?? "")),
  );
  if (!result.ok) return result;
  revalidatePath("/inventario");
  redirect("/inventario?archivado=1");
}

export async function reactivateProductAction(
  productId: string,
): Promise<StatusActionResult> {
  const result = await statusChange((actor) =>
    reactivateProduct(actor, String(productId)),
  );
  revalidatePath("/inventario");
  return result;
}

export type PresentationFormState = {
  fieldErrors: Partial<Record<PresentationField, string>>;
  formError?: string;
  values: { name: string; factor: string };
};

/** Adds a presentation to a product. The product id is bound by the page
 * and looked for only inside the company of the session. */
export async function createPresentationAction(
  productId: string,
  _prev: PresentationFormState,
  formData: FormData,
): Promise<PresentationFormState> {
  const { user, organization } = await requireOrganizationContext();
  const values = {
    name: String(formData.get("name") ?? ""),
    factor: String(formData.get("factor") ?? ""),
  };
  let result;
  try {
    result = await createPresentation(
      { organizationId: organization.id, userId: user.id },
      String(productId),
      values,
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
      formError: result.formError,
      values,
    };
  }
  revalidatePath(`/inventario/${productId}/editar`);
  return { fieldErrors: {}, values: { name: "", factor: "" } };
}
