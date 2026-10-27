import "server-only";

import {
  formatStock,
  getStockByLocation,
  getStockTotals,
  listStockLocations,
} from "@/modules/inventory";
import { assertModulePermission } from "@/platform/billing";
import { getProduct, listProducts } from "@/platform/catalog";

import { getSalePrices, type SalesActor } from "./prices";

/**
 * What the counter needs to put a product in the cart (VEN-06): how it is
 * sold (by piece, by box) with its price, and where there is some. Built
 * in the server; the browser sends back only ids and what was typed.
 */
export type SaleProduct = {
  id: string;
  name: string;
  sku: string;
  /** "base" first, then "p:<presentation id>"; only what has a price. */
  captures: { value: string; label: string; price: string }[];
  /** Locations that hold some of it, «General» first. Empty = none. */
  locations: { id: string; label: string }[];
};

/** Null when it does not exist in the company or is archived. */
export async function getSaleProduct(
  actor: SalesActor,
  productId: string,
): Promise<SaleProduct | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.create",
  );
  const id = String(productId).slice(0, 36);
  const product = await getProduct(actor, id);
  if (!product || product.status !== "ACTIVE") return null;
  const [prices, locations, stock] = await Promise.all([
    getSalePrices(actor, product.id),
    listStockLocations(actor),
    getStockByLocation(actor, product.id),
  ]);
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    captures: (prices?.rows ?? []).flatMap((row) =>
      row.sellsAt
        ? [
            {
              value: row.presentationId ? `p:${row.presentationId}` : "base",
              label: row.label,
              price: row.sellsAt,
            },
          ]
        : [],
    ),
    locations: locations
      .filter((location) => stock[location.id])
      .map((location) => ({
        id: location.id,
        label: `${location.path} — hay ${formatStock(stock[location.id]!, product.unitCode)}`,
      })),
  };
}

export type SaleSearch = {
  /** The product whose SKU or barcode is exactly what was typed. */
  exact: SaleProduct | null;
  candidates: { id: string; name: string; sku: string; stock: string }[];
};

/** Products to add to the cart, by name, SKU or barcode. Reads only. */
export async function findSaleProducts(
  actor: SalesActor,
  query: string,
): Promise<SaleSearch> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.create",
  );
  const search = String(query ?? "").slice(0, 100);
  if (search.trim() === "") return { exact: null, candidates: [] };
  const list = await listProducts(actor, { search, pageSize: 8 });
  if (list.exact) {
    const exact = await getSaleProduct(actor, list.exact.id);
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
