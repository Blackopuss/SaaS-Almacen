import "server-only";

import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

import type { InventoryActor } from "./movements";

/**
 * Where a new company is on its way to a working inventory (IMP-12):
 * products in the catalog, how much there is of them, and a first
 * movement. Nothing is stored for it — no «done» flags to keep in step:
 * every answer is read from what already exists, so the guide cannot say
 * something the inventory does not.
 */
export type FirstSteps = {
  /** There is at least one product in the catalog. */
  hasProducts: boolean;
  /** Some product has stock: an initial balance or anything that entered. */
  hasStock: boolean;
  /** Something moved after the starting stock: an entry, an exit… */
  hasMovement: boolean;
  /** The three are done: the guide has nothing more to say. */
  complete: boolean;
};

export async function getFirstSteps(
  actor: InventoryActor,
): Promise<FirstSteps> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.product.read",
  );
  const client = forOrganization(organizationId);
  // One row is enough for each question: none of these counts the table.
  const [product, line, movement] = await Promise.all([
    client.product.findFirst({ select: { id: true } }),
    client.stockMovementLine.findFirst({ select: { id: true } }),
    client.stockMovement.findFirst({
      where: { type: { not: "INITIAL" } },
      select: { id: true },
    }),
  ]);
  const hasProducts = product !== null;
  const hasStock = line !== null;
  const hasMovement = movement !== null;
  return {
    hasProducts,
    hasStock,
    hasMovement,
    complete: hasProducts && hasStock && hasMovement,
  };
}
