import "server-only";

import {
  formatStock,
  getStockByLocation,
  listStockLocations,
  type InventoryActor,
} from "@/modules/inventory";
import { getProduct, listPresentations } from "@/platform/catalog";

import { captureOptions, type CaptureOption } from "../capture-options";

/**
 * What the quick exit needs to capture a line of a product (INV-28): how
 * it can be counted and where there is some. Built in the server; the
 * browser only sends back ids and what was typed.
 */
export type ExitProduct = {
  id: string;
  name: string;
  sku: string;
  captures: CaptureOption[];
  /** Locations that hold some of it, «General» first. Empty = no stock. */
  locations: { id: string; label: string }[];
};

/** Null when the product does not exist in the company or is archived. */
export async function loadExitProduct(
  actor: InventoryActor,
  productId: string,
  canReadPresentations: boolean,
): Promise<ExitProduct | null> {
  const product = await getProduct(actor, String(productId).slice(0, 36));
  if (!product || product.status !== "ACTIVE") return null;
  const [locations, stock, presentations] = await Promise.all([
    listStockLocations(actor),
    getStockByLocation(actor, product.id),
    canReadPresentations ? listPresentations(actor, product.id) : [],
  ]);
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    captures: captureOptions(product, presentations),
    locations: locations
      .filter((location) => stock[location.id])
      .map((location) => ({
        id: location.id,
        label: `${location.path} — hay ${formatStock(stock[location.id]!, product.unitCode)}`,
      })),
  };
}
