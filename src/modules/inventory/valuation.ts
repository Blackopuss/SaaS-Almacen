import "server-only";

import { Decimal, dec, newId, type DecimalInput } from "@/lib";
import type { TenantDb } from "@/server";

import {
  COST_SCALE,
  valueEntry,
  valueExit,
  valueExitAt,
  type CostState,
  type Valued,
} from "./average-cost";

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/**
 * The average cost of the products of one movement (VAL, ADR 0031), kept
 * while its lines are written. The caller must hold the lock of every
 * product (`lockRows(tx, "product", …)`) and open the book before changing
 * any balance: it reads the cost and the stock of all locations as they
 * were. Each line goes through `entry`/`exit` in order and the book is
 * saved at the end, in the same transaction.
 */
export type CostBook = {
  entry(
    productId: string,
    quantity: DecimalInput,
    unitCost: DecimalInput | null,
  ): Decimal | null;
  exit(productId: string, quantity: DecimalInput): Decimal | null;
  /** Exit at the cost it entered with (returns, reversals of entries). */
  exitAt(
    productId: string,
    quantity: DecimalInput,
    unitCost: DecimalInput | null,
  ): Decimal | null;
  /** Average cost in force, changing nothing (relocations). */
  price(productId: string): Decimal | null;
  save(): Promise<void>;
};

type Page = {
  state: CostState | null;
  onHand: Decimal;
  rowId: string | null;
  changed: boolean;
};

export async function openCostBook(
  tx: Tx,
  organizationId: string,
  productIds: readonly string[],
): Promise<CostBook> {
  const ids = [...new Set(productIds)];
  const [costs, stock] = await Promise.all([
    tx.productCost.findMany({
      where: { productId: { in: ids } },
      select: {
        id: true,
        productId: true,
        averageCost: true,
        stockValue: true,
      },
    }),
    tx.stockBalance.groupBy({
      by: ["productId"],
      where: { productId: { in: ids } },
      _sum: { quantity: true },
    }),
  ]);
  const pages = new Map<string, Page>();
  for (const id of ids) {
    const row = costs.find((cost) => cost.productId === id);
    const sum = stock.find((each) => each.productId === id)?._sum.quantity;
    pages.set(id, {
      state: row
        ? {
            averageCost: dec(row.averageCost.toString()),
            stockValue: dec(row.stockValue.toString()),
          }
        : null,
      onHand: dec(sum?.toString() ?? "0"),
      rowId: row?.id ?? null,
      changed: false,
    });
  }

  const pageOf = (productId: string) => {
    const page = pages.get(productId);
    if (!page) throw new Error(`Product not in the cost book: ${productId}`);
    return page;
  };
  const apply = (page: Page, valued: Valued, delta: Decimal) => {
    page.state = valued.state;
    page.onHand = page.onHand.plus(delta);
    page.changed = true;
    return valued.unitCost;
  };

  return {
    entry(productId, quantity, unitCost) {
      const page = pageOf(productId);
      return apply(
        page,
        valueEntry(page.state, page.onHand, quantity, unitCost),
        dec(quantity),
      );
    },
    exit(productId, quantity) {
      const page = pageOf(productId);
      return apply(
        page,
        valueExit(page.state, page.onHand, quantity),
        dec(quantity).negated(),
      );
    },
    exitAt(productId, quantity, unitCost) {
      const page = pageOf(productId);
      return apply(
        page,
        valueExitAt(page.state, page.onHand, quantity, unitCost),
        dec(quantity).negated(),
      );
    },
    price(productId) {
      return pageOf(productId).state?.averageCost ?? null;
    },
    async save() {
      for (const [productId, page] of pages) {
        if (!page.changed || !page.state) continue;
        const data = {
          averageCost: page.state.averageCost.toFixed(COST_SCALE),
          stockValue: page.state.stockValue.toFixed(COST_SCALE),
        };
        if (page.rowId) {
          await tx.productCost.updateMany({
            where: { id: page.rowId },
            data,
          });
        } else {
          // Under the product's lock: nobody else can be creating it.
          await tx.productCost.create({
            data: { id: newId(), organizationId, productId, ...data },
          });
        }
      }
    },
  };
}

/** Cost of one unit of the product from the cost of one captured unit. */
export function costPerUnit(
  costPerCaptured: DecimalInput | null | undefined,
  factor: DecimalInput,
): Decimal | null {
  if (costPerCaptured === null || costPerCaptured === undefined) return null;
  return dec(costPerCaptured)
    .dividedBy(dec(factor))
    .toDecimalPlaces(COST_SCALE, Decimal.ROUND_HALF_UP);
}

/** «85.000000» for a line, or null. */
export const lineCost = (cost: Decimal | null) =>
  cost ? cost.toFixed(COST_SCALE) : null;
