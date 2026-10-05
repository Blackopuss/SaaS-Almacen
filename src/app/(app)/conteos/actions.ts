"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  cancelCount,
  captureCount,
  openCount,
  removeCapture,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";
import {
  getProduct,
  listPresentations,
  listProducts,
} from "@/platform/catalog";
import { requireOrganizationContext } from "@/platform/tenancy";

import {
  captureOptions,
  type CaptureOption,
} from "../movimientos/capture-options";

export type OpenCountState = {
  error?: string;
  /** A count already open in that location, to go on with it. */
  openCountId?: string;
  values: { locationId: string; note: string };
};

/**
 * Starts the count of a location (INV-31). Person and company come from
 * the session; the location is looked for only inside that company.
 */
export async function openCountAction(
  _prev: OpenCountState,
  formData: FormData,
): Promise<OpenCountState> {
  const { user, organization } = await requireOrganizationContext();
  const values = {
    locationId: String(formData.get("locationId") ?? "").slice(0, 36),
    note: String(formData.get("note") ?? "").slice(0, 300),
  };
  let result;
  try {
    result = await openCount(
      { organizationId: organization.id, userId: user.id },
      values,
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { error: error.message, values };
    }
    throw error;
  }
  if (!result.ok) {
    return { error: result.error, openCountId: result.openCountId, values };
  }
  revalidatePath("/conteos");
  redirect(`/conteos/${result.countId}`);
}

/** A product ready to be counted: how it can be written down. */
export type CountProduct = {
  id: string;
  name: string;
  sku: string;
  captures: CaptureOption[];
};

export type CountSearch = {
  /** The product whose SKU or barcode is exactly what was typed or scanned. */
  exact: CountProduct | null;
  candidates: { id: string; name: string; sku: string }[];
  error?: string;
};

async function countProduct(
  access: Awaited<ReturnType<typeof getModuleAccess>>,
  productId: string,
): Promise<CountProduct | null> {
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const product = await getProduct(actor, String(productId).slice(0, 36));
  if (!product || product.status !== "ACTIVE") return null;
  const presentations = access.can("inventory.presentation.read")
    ? await listPresentations(actor, product.id)
    : [];
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    captures: captureOptions(product, presentations),
  };
}

/**
 * Looks for products to count (reads only). Person and company come from
 * the session; only products of that company are found.
 */
export async function findCountProductsAction(
  query: string,
): Promise<CountSearch> {
  const access = await getModuleAccess();
  if (!access.allows("inventory.count.update")) {
    return {
      exact: null,
      candidates: [],
      error: "No tienes permiso para capturar conteos.",
    };
  }
  const search = String(query ?? "").slice(0, 100);
  if (search.trim() === "") return { exact: null, candidates: [] };
  const list = await listProducts(
    { organizationId: access.organization.id, userId: access.user.id },
    { search, pageSize: 8 },
  );
  if (list.exact) {
    const exact = await countProduct(access, list.exact.id);
    if (exact) return { exact, candidates: [] };
  }
  return {
    exact: null,
    candidates: list.items.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
    })),
  };
}

/** One product chosen from the candidates. */
export async function loadCountProductAction(
  productId: string,
): Promise<CountProduct | null> {
  const access = await getModuleAccess();
  if (!access.allows("inventory.count.update")) return null;
  return countProduct(access, String(productId));
}

export type CaptureState =
  | { ok: true; summary: string; mixed: boolean }
  | { ok: false; field?: "productId" | "quantity"; error: string };

/**
 * Writes down what was found of a product in a count. Only ids and what
 * was typed travel; the content of a presentation is read in the server.
 */
export async function captureCountAction(
  countId: string,
  productId: string,
  capture: string,
  quantity: string,
): Promise<CaptureState> {
  const { user, organization } = await requireOrganizationContext();
  const how = String(capture ?? "");
  try {
    const result = await captureCount(
      { organizationId: organization.id, userId: user.id },
      {
        countId: String(countId),
        productId: String(productId),
        quantity: String(quantity ?? "").slice(0, 40),
        ...(how.startsWith("p:")
          ? { presentationId: how.slice(2) }
          : how.startsWith("u:")
            ? { unitCode: how.slice(2) }
            : {}),
      },
    );
    if (!result.ok) {
      return { ok: false, field: result.field, error: result.error };
    }
    revalidatePath(`/conteos/${String(countId)}`);
    return { ok: true, summary: result.summary, mixed: result.mixed };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

export type CountChangeState = { ok: true } | { ok: false; error: string };

/** Takes back one capture of an open count. */
export async function removeCaptureAction(
  countId: string,
  captureId: string,
): Promise<CountChangeState> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await removeCapture(
      { organizationId: organization.id, userId: user.id },
      { countId: String(countId), captureId: String(captureId) },
    );
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath(`/conteos/${String(countId)}`);
    return { ok: true };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

/** Abandons an open count; stock is not touched. */
export async function cancelCountAction(
  countId: string,
): Promise<CountChangeState> {
  const { user, organization } = await requireOrganizationContext();
  try {
    const result = await cancelCount(
      { organizationId: organization.id, userId: user.id },
      String(countId),
    );
    if (!result.ok) return { ok: false, error: result.error };
    revalidatePath("/conteos");
    revalidatePath(`/conteos/${String(countId)}`);
    return { ok: true };
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
