"use server";

import {
  SALE_MAX_LINES,
  findSaleProducts,
  getSaleProduct,
  quoteSale,
  type CartQuote,
  type SaleProduct,
  type SaleSearch,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

/**
 * The counter (VEN-06). Person and company come from the session; only
 * products of that company are found and priced. These actions only read.
 */

async function seller() {
  const access = await getModuleAccess();
  if (!access.allows("sales.sale.create")) return null;
  return { organizationId: access.organization.id, userId: access.user.id };
}

const NOT_ALLOWED = "No tienes permiso para vender.";

export async function findSaleProductsAction(
  query: string,
): Promise<SaleSearch & { error?: string }> {
  const actor = await seller();
  if (!actor) return { exact: null, candidates: [], error: NOT_ALLOWED };
  return findSaleProducts(actor, String(query ?? "").slice(0, 100));
}

export async function loadSaleProductAction(
  productId: string,
): Promise<SaleProduct | null> {
  const actor = await seller();
  if (!actor) return null;
  return getSaleProduct(actor, String(productId));
}

/** Prices and totals of the cart, computed here; never in the browser. */
export async function quoteSaleAction(
  lines: unknown,
): Promise<CartQuote | { error: string }> {
  const actor = await seller();
  if (!actor) return { error: NOT_ALLOWED };
  const sent = Array.isArray(lines) ? lines.slice(0, SALE_MAX_LINES) : [];
  return quoteSale(actor, {
    lines: sent.map((line) => {
      const fields =
        line && typeof line === "object"
          ? (line as Record<string, unknown>)
          : {};
      const field = (name: string) =>
        typeof fields[name] === "string" ? fields[name].slice(0, 100) : "";
      return {
        productId: field("productId"),
        capture: field("capture"),
        quantity: field("quantity"),
        locationId: field("locationId"),
      };
    }),
  });
}
