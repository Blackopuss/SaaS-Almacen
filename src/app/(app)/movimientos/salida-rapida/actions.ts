"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  formatStock,
  getStockTotals,
  registerQuickExit,
  type QuickExitField,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";
import { listProducts } from "@/platform/catalog";
import { requireOrganizationContext } from "@/platform/tenancy";

import { loadExitProduct, type ExitProduct } from "./exit-product";

export type ExitCandidate = {
  id: string;
  name: string;
  sku: string;
  /** «Hay 88 piezas». */
  stock: string;
};

export type ExitSearch = {
  /** The product whose SKU or barcode is exactly what was typed or scanned. */
  exact: ExitProduct | null;
  candidates: ExitCandidate[];
  error?: string;
};

/**
 * Looks for products to add to a quick exit (INV-28). Person and company
 * come from the session; only products of that company are found. Reads
 * only.
 */
export async function findExitProductsAction(
  query: string,
): Promise<ExitSearch> {
  const access = await getModuleAccess();
  if (!access.allows("inventory.exit.create")) {
    return {
      exact: null,
      candidates: [],
      error: "No tienes permiso para registrar salidas.",
    };
  }
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const search = String(query ?? "").slice(0, 100);
  if (search.trim() === "") return { exact: null, candidates: [] };
  const list = await listProducts(actor, { search, pageSize: 8 });
  if (list.exact) {
    const exact = await loadExitProduct(
      actor,
      list.exact.id,
      access.can("inventory.presentation.read"),
    );
    if (exact) return { exact, candidates: [] };
  }
  const totals = await getStockTotals(
    actor,
    list.items.map((product) => product.id),
  );
  return {
    exact: null,
    candidates: list.items.map((product) => ({
      id: product.id,
      name: product.name,
      sku: product.sku,
      stock: `Hay ${formatStock(totals[product.id] ?? "0", product.unitCode)}`,
    })),
  };
}

/** One product chosen from the candidates, ready to capture its line. */
export async function loadExitProductAction(
  productId: string,
): Promise<ExitProduct | null> {
  const access = await getModuleAccess();
  if (!access.allows("inventory.exit.create")) return null;
  return loadExitProduct(
    { organizationId: access.organization.id, userId: access.user.id },
    String(productId),
    access.can("inventory.presentation.read"),
  );
}

export type QuickExitState = {
  /** Problem of each line, by its position in what was sent. */
  lineErrors: Record<number, string>;
  fieldErrors: Partial<Record<QuickExitField, string>>;
  formError?: string;
};

/** "base", "p:<presentation id>" or "u:<unit code>", as the form sends it. */
function captureFields(capture: string): {
  presentationId?: string;
  unitCode?: string;
} {
  if (capture.startsWith("p:")) return { presentationId: capture.slice(2) };
  if (capture.startsWith("u:")) return { unitCode: capture.slice(2) };
  return {};
}

/**
 * Confirms a quick exit: every line leaves or none does. The lines travel
 * as text typed by the person plus ids; products, presentations and
 * locations are looked for only inside the company of the session.
 */
export async function registerQuickExitAction(
  _prev: QuickExitState,
  formData: FormData,
): Promise<QuickExitState> {
  const { user, organization } = await requireOrganizationContext();
  const text = (name: string) => String(formData.get(name) ?? "");
  let sent: unknown = [];
  try {
    sent = JSON.parse(text("lines").slice(0, 60_000));
  } catch {
    sent = [];
  }
  // One more than the limit, so the service can say it is too long.
  const lines = (Array.isArray(sent) ? sent.slice(0, 51) : []).map((line) => {
    const fields =
      line && typeof line === "object" ? (line as Record<string, unknown>) : {};
    const field = (name: string) =>
      typeof fields[name] === "string" ? fields[name].slice(0, 100) : "";
    return {
      productId: field("productId"),
      locationId: field("locationId"),
      quantity: field("quantity"),
      ...captureFields(field("capture")),
    };
  });
  let result;
  try {
    result = await registerQuickExit(
      { organizationId: organization.id, userId: user.id },
      {
        lines,
        reason: text("reason"),
        reference: text("reference"),
        // Created with the screen and resent on every retry (INV-21).
        idempotencyKey: text("idempotencyKey"),
      },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { lineErrors: {}, fieldErrors: {}, formError: error.message };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      lineErrors: result.lineErrors,
      fieldErrors: result.fieldErrors,
      formError: result.formError,
    };
  }
  revalidatePath("/movimientos");
  revalidatePath("/inventario");
  redirect(`/movimientos?registrado=${result.movementId}`);
}
