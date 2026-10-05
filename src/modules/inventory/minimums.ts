import "server-only";

import { dec, newId } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { parseQuantity } from "@/platform/catalog";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { formatStock, type InventoryActor } from "./movements";

/**
 * Minimums and low stock (INV-30). A minimum is the lowest quantity the
 * company wants of a product, in the product's unit and counting every
 * location. A product is low when its real balance — the one only
 * movements change — is at or below its minimum. Nothing is stored about
 * being low: it is always worked out from the balance.
 */

export const LOW_STOCK_PAGE_SIZE = 25;

/** Products with a minimum that are looked at in one go. */
const MAX_MINIMUMS = 5_000;

export type SetMinimumResult =
  | {
      ok: true;
      /** Null when the minimum was removed. */
      minimum: string | null;
      /** «Mínimo de Tornillo: 20 piezas.» */
      summary: string;
    }
  | { ok: false; reason: "invalid" | "not_found"; error: string };

/**
 * Sets, changes or — with an empty quantity — removes the minimum of a
 * product. The quantity follows the rule of the product (whole pieces,
 * centimetres of a metre…).
 */
export async function setMinimum(
  actor: InventoryActor,
  input: { productId: string; quantity: string },
): Promise<SetMinimumResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.minimum.update",
  );
  const typed = String(input.quantity ?? "").trim();

  return forOrganization(organizationId).$transaction(async (tx) => {
    // Two people setting it at once write one after the other.
    const [productId] = await lockRows(tx, "product", [
      String(input.productId).slice(0, 36),
    ]);
    const product = productId
      ? await tx.product.findFirst({
          where: { id: productId },
          select: { id: true, name: true, unitCode: true, quantityStep: true },
        })
      : null;
    if (!product) {
      return {
        ok: false as const,
        reason: "not_found" as const,
        error: "Este producto ya no existe.",
      };
    }
    if (typed === "") {
      await tx.stockMinimum.deleteMany({ where: { productId: product.id } });
      return {
        ok: true as const,
        minimum: null,
        summary: `${product.name} ya no tiene mínimo.`,
      };
    }
    const parsed = parseQuantity(
      {
        unitCode: product.unitCode,
        quantityStep: product.quantityStep.toString(),
      },
      typed,
    );
    if (!parsed.ok) {
      return {
        ok: false as const,
        reason: "invalid" as const,
        error: parsed.error,
      };
    }
    const quantity = parsed.quantity.toString();
    const changed = await tx.stockMinimum.updateMany({
      where: { productId: product.id },
      data: { quantity, updatedByUserId: userId },
    });
    if (changed.count === 0) {
      await tx.stockMinimum.create({
        data: {
          id: newId(),
          organizationId,
          productId: product.id,
          quantity,
          updatedByUserId: userId,
        },
      });
    }
    return {
      ok: true as const,
      minimum: quantity,
      summary: `Mínimo de ${product.name}: ${formatStock(quantity, product.unitCode)}.`,
    };
  }, LOCKING_TRANSACTION);
}

/** Minimum of a product in its unit ("20"), or null when it has none. */
export async function getMinimum(
  actor: InventoryActor,
  productId: string,
): Promise<string | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.minimum.read",
  );
  const minimum = await forOrganization(
    actor.organizationId,
  ).stockMinimum.findFirst({
    where: { productId: String(productId) },
    select: { quantity: true },
  });
  return minimum ? minimum.quantity.toString() : null;
}

export type LowStockItem = {
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  /** Real balance, every location added up: "4". */
  stock: string;
  /** «4 piezas». */
  stockLabel: string;
  minimum: string;
  /** «20 piezas». */
  minimumLabel: string;
  /** What is missing to be above the line: «16 piezas». */
  missingLabel: string;
  /** Nothing left at all. */
  empty: boolean;
};

export type LowStockPage = {
  items: LowStockItem[];
  total: number;
  page: number;
  pageCount: number;
  /** Active products that have a minimum, low or not. */
  withMinimum: number;
};

/** Every low product of the company, the most urgent first. */
async function lowStock(
  actor: InventoryActor,
): Promise<{ items: LowStockItem[]; withMinimum: number }> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.minimum.read",
  );
  const client = forOrganization(actor.organizationId);
  const minimums = await client.stockMinimum.findMany({
    // An archived product is not bought again: it is never «low».
    where: { product: { status: "ACTIVE" } },
    take: MAX_MINIMUMS,
    select: {
      productId: true,
      quantity: true,
      product: { select: { name: true, sku: true, unitCode: true } },
    },
  });
  const totals = new Map<string, string>();
  const ids = minimums.map((minimum) => minimum.productId);
  for (let start = 0; start < ids.length; start += 1_000) {
    const sums = await client.stockBalance.groupBy({
      by: ["productId"],
      where: { productId: { in: ids.slice(start, start + 1_000) } },
      _sum: { quantity: true },
    });
    for (const row of sums) {
      totals.set(row.productId, (row._sum.quantity ?? 0).toString());
    }
  }

  const items = minimums.flatMap((row) => {
    const stock = dec(totals.get(row.productId) ?? 0);
    const minimum = dec(row.quantity.toString());
    if (stock.greaterThan(minimum)) return [];
    const { name, sku, unitCode } = row.product;
    return [
      {
        item: {
          productId: row.productId,
          name,
          sku,
          unitCode,
          stock: stock.toString(),
          stockLabel: formatStock(stock.toString(), unitCode),
          minimum: minimum.toString(),
          minimumLabel: formatStock(minimum.toString(), unitCode),
          missingLabel: formatStock(minimum.minus(stock).toString(), unitCode),
          empty: stock.isZero(),
        } satisfies LowStockItem,
        // Share of the minimum that is left: 0 = nothing, 1 = at the line.
        left: stock.dividedBy(minimum),
      },
    ];
  });
  items.sort(
    (a, b) =>
      a.left.comparedTo(b.left) ||
      a.item.name.localeCompare(b.item.name, "es") ||
      a.item.sku.localeCompare(b.item.sku, "es"),
  );
  return {
    items: items.map((entry) => entry.item),
    withMinimum: minimums.length,
  };
}

/**
 * Products at or below their minimum, the emptiest first, one page at a
 * time. Only products of the company of the actor.
 */
export async function listLowStock(
  actor: InventoryActor,
  options: { page?: number } = {},
): Promise<LowStockPage> {
  const { items, withMinimum } = await lowStock(actor);
  const pageCount = Math.max(1, Math.ceil(items.length / LOW_STOCK_PAGE_SIZE));
  const requested = Number.isInteger(options.page) ? Number(options.page) : 1;
  const page = Math.min(Math.max(requested, 1), pageCount);
  return {
    items: items.slice(
      (page - 1) * LOW_STOCK_PAGE_SIZE,
      page * LOW_STOCK_PAGE_SIZE,
    ),
    total: items.length,
    page,
    pageCount,
    withMinimum,
  };
}

/** How many products are low right now. */
export async function countLowStock(actor: InventoryActor): Promise<number> {
  return (await lowStock(actor)).items.length;
}
