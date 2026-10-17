import "server-only";

import { dec, formatDecimal, isAppError, newId } from "@/lib";
import { formatStock } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { pluralizeName, resolveConversion } from "@/platform/catalog";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import { PURCHASE_ORDER_MAX_LINES, formatOrderNumber } from "./orders";
import type { PurchasingActor } from "./product-suppliers";

/**
 * Purchase suggestions from minimums (CMP-14). A product is suggested
 * when its stock is at or below its minimum (INV-30) and what is already
 * on its way — drafts, sent orders and the rest of orders received in
 * part — does not lift it back to the minimum. The quantity fills the gap
 * in the way it is bought from its supplier (whole boxes, or the product's
 * step), at least one of them.
 *
 * The supplier is the one it was last bought from (last cost), or the
 * first one it was linked to. Nothing is stored: suggestions are worked
 * out each time, and generating recomputes them under the locks of the
 * products, so two generations at once never order twice: the second
 * sees the drafts of the first as already on their way.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Reader = Pick<
  Tx,
  | "stockMinimum"
  | "stockBalance"
  | "purchaseOrderLine"
  | "purchaseReceiptLine"
  | "productSupplier"
>;
type Decimal = ReturnType<typeof dec>;

/** Products with a minimum that are looked at in one go (as INV-30). */
const MAX_MINIMUMS = 5_000;

export type Suggestion = {
  productId: string;
  name: string;
  sku: string;
  /** «4 piezas». */
  stockText: string;
  /** «20 piezas». */
  minimumText: string;
  /** «10 piezas» already on its way; null when nothing is. */
  incomingText: string | null;
  /** What to order: «2 cajas (200 piezas)», «16 piezas». */
  quantityText: string;
  /** Null when the product has no supplier to order it from. */
  supplierId: string | null;
};

export type SuggestionGroup = {
  /** Null: products with no supplier linked. */
  supplierId: string | null;
  supplierName: string | null;
  items: Suggestion[];
};

export type PurchaseSuggestions = {
  /** By supplier, by name; products without supplier last. */
  groups: SuggestionGroup[];
  /** Low products whose orders on their way already cover them. */
  covered: {
    productId: string;
    name: string;
    sku: string;
    incomingText: string;
  }[];
};

type Planned = Suggestion & {
  supplierName: string | null;
  /** How the line asks for it: a presentation or the unit. */
  presentationId: string | null;
  quantity: Decimal;
  /** The last cost, when it was for this very way of buying it. */
  lastCost: string | null;
};

type Plan = {
  planned: Planned[];
  covered: PurchaseSuggestions["covered"];
};

/** Rounds up to a multiple of `step`. */
function roundUp(value: Decimal, step: Decimal): Decimal {
  return value.dividedBy(step).ceil().times(step);
}

/**
 * Works out the suggestions of the company, or only of some products.
 * Read-only; inside a transaction it sees what is committed when called.
 */
async function plan(client: Reader, productIds?: string[]): Promise<Plan> {
  const minimums = await client.stockMinimum.findMany({
    where: {
      product: { status: "ACTIVE" },
      ...(productIds ? { productId: { in: productIds } } : {}),
    },
    take: MAX_MINIMUMS,
    select: {
      productId: true,
      quantity: true,
      product: {
        select: {
          name: true,
          sku: true,
          unitCode: true,
          quantityStep: true,
        },
      },
    },
  });
  if (minimums.length === 0) return { planned: [], covered: [] };
  const ids = minimums.map((row) => row.productId);

  const stock = new Map<string, Decimal>();
  const incoming = new Map<string, Decimal>();
  for (let start = 0; start < ids.length; start += 1_000) {
    const slice = ids.slice(start, start + 1_000);
    const sums = await client.stockBalance.groupBy({
      by: ["productId"],
      where: { productId: { in: slice } },
      _sum: { quantity: true },
    });
    for (const row of sums) {
      stock.set(row.productId, dec((row._sum.quantity ?? 0).toString()));
    }
  }
  const low = minimums.filter((row) =>
    (stock.get(row.productId) ?? dec(0)).lessThanOrEqualTo(
      row.quantity.toString(),
    ),
  );
  if (low.length === 0) return { planned: [], covered: [] };
  const lowIds = low.map((row) => row.productId);

  // On its way: what drafts and open orders still wait for, in the
  // product's unit with the content each line was ordered with.
  const open = await client.purchaseOrderLine.findMany({
    where: {
      productId: { in: lowIds },
      order: { status: { in: ["DRAFT", "SENT", "PARTIAL"] } },
    },
    select: { id: true, productId: true, capturedQuantity: true, factor: true },
  });
  const arrived = new Map<string, Decimal>();
  if (open.length > 0) {
    const rows = await client.purchaseReceiptLine.groupBy({
      by: ["orderLineId"],
      where: { orderLineId: { in: open.map((line) => line.id) } },
      _sum: { capturedQuantity: true },
    });
    for (const row of rows) {
      arrived.set(
        row.orderLineId,
        dec(row._sum.capturedQuantity?.toString() ?? 0),
      );
    }
  }
  for (const line of open) {
    const left = dec(line.capturedQuantity.toString()).minus(
      arrived.get(line.id) ?? dec(0),
    );
    if (left.lessThanOrEqualTo(0)) continue;
    incoming.set(
      line.productId,
      (incoming.get(line.productId) ?? dec(0)).plus(
        left.times(line.factor.toString()),
      ),
    );
  }

  // Who to buy it from: the supplier it was last bought from, else the
  // first one linked. Archived suppliers are not ordered from.
  const links = await client.productSupplier.findMany({
    where: {
      productId: { in: lowIds },
      contact: { isSupplier: true, archivedAt: null },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      productId: true,
      contactId: true,
      presentationId: true,
      lastCost: true,
      lastCostAt: true,
      lastCostPresentationId: true,
      contact: { select: { name: true } },
      presentation: {
        select: {
          name: true,
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { factor: true },
          },
        },
      },
    },
  });
  type Link = (typeof links)[number];
  const chosen = new Map<string, Link>();
  for (const link of links) {
    const before = chosen.get(link.productId);
    if (
      !before ||
      (link.lastCostAt &&
        (!before.lastCostAt || link.lastCostAt > before.lastCostAt))
    ) {
      chosen.set(link.productId, link);
    }
  }

  const planned: Planned[] = [];
  const covered: Plan["covered"] = [];
  for (const row of low) {
    const { name, sku, unitCode } = row.product;
    const have = stock.get(row.productId) ?? dec(0);
    const coming = incoming.get(row.productId) ?? dec(0);
    const minimum = dec(row.quantity.toString());
    const gap = minimum.minus(have).minus(coming);
    const incomingText = coming.greaterThan(0)
      ? formatStock(coming.toString(), unitCode)
      : null;
    if (coming.greaterThan(0) && gap.lessThanOrEqualTo(0)) {
      covered.push({
        productId: row.productId,
        name,
        sku,
        incomingText: incomingText!,
      });
      continue;
    }
    const link = chosen.get(row.productId) ?? null;
    const factor = link?.presentation?.versions[0]?.factor;
    const byPresentation = Boolean(link?.presentationId && factor);
    let quantity: Decimal;
    let quantityText: string;
    if (byPresentation) {
      const content = dec(factor!.toString());
      quantity = atLeastOne(gap.dividedBy(content).ceil());
      const plural = pluralizeName(link!.presentation!.name, quantity);
      quantityText = `${formatDecimal(quantity)} ${plural.toLowerCase()} (${formatStock(quantity.times(content).toString(), unitCode)})`;
    } else {
      const step = dec(row.product.quantityStep.toString());
      quantity = roundUp(gap.greaterThan(0) ? gap : step, step);
      if (quantity.lessThan(step)) quantity = step;
      quantityText = formatStock(quantity.toString(), unitCode);
    }
    const presentationId = byPresentation ? link!.presentationId : null;
    planned.push({
      productId: row.productId,
      name,
      sku,
      stockText: formatStock(have.toString(), unitCode),
      minimumText: formatStock(minimum.toString(), unitCode),
      incomingText,
      quantityText,
      supplierId: link?.contactId ?? null,
      supplierName: link?.contact.name ?? null,
      presentationId,
      quantity,
      lastCost:
        link?.lastCost && link.lastCostPresentationId === presentationId
          ? link.lastCost.toString()
          : null,
    });
  }
  planned.sort(
    (a, b) =>
      a.name.localeCompare(b.name, "es") || a.sku.localeCompare(b.sku, "es"),
  );
  return { planned, covered };
}

/** At least one presentation. */
function atLeastOne(value: Decimal): Decimal {
  return value.lessThan(1) ? dec(1) : value;
}

/** What to buy now, by supplier (CMP-14). */
export async function getPurchaseSuggestions(
  actor: PurchasingActor,
): Promise<PurchaseSuggestions> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.suggestion.read",
  );
  const { planned, covered } = await plan(
    forOrganization(actor.organizationId),
  );
  const groups = new Map<string, SuggestionGroup>();
  for (const item of planned) {
    const key = item.supplierId ?? "";
    const group = groups.get(key) ?? {
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      items: [],
    };
    group.items.push({
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      stockText: item.stockText,
      minimumText: item.minimumText,
      incomingText: item.incomingText,
      quantityText: item.quantityText,
      supplierId: item.supplierId,
    });
    groups.set(key, group);
  }
  return {
    groups: [...groups.values()].sort((a, b) =>
      a.supplierName === null
        ? 1
        : b.supplierName === null
          ? -1
          : a.supplierName.localeCompare(b.supplierName, "es"),
    ),
    covered: covered.sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}

export type GenerateSuggestedResult =
  | {
      ok: true;
      orders: {
        orderId: string;
        numberText: string;
        supplierName: string;
        lines: number;
      }[];
      /** «Se creó el borrador OC-0004 para Ferretera del Norte con 3 productos.» */
      summary: string;
    }
  | { ok: false; reason: "invalid"; error: string };

class NumberTaken extends Error {}

/**
 * Creates one draft per supplier with what is suggested for the given
 * products (CMP-14), recomputed here under their locks: the browser only
 * says which products. Products without supplier, or already covered by
 * what is on its way, are left out. Costs go in only for who may record
 * them, and only when the last cost was for the same way of buying it.
 */
export async function generateSuggestedOrders(
  actor: PurchasingActor,
  input: { productIds: string[] },
): Promise<GenerateSuggestedResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.suggestion.generate",
  );
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.order.create",
  );
  const withCosts = await mayRecordCosts(actor);
  const asked = [
    ...new Set(
      (Array.isArray(input.productIds) ? input.productIds : [])
        .map((id) => String(id).slice(0, 36))
        .filter(Boolean),
    ),
  ].slice(0, 1_000);
  if (asked.length === 0) {
    return {
      ok: false,
      reason: "invalid",
      error: "Elige qué productos pedir.",
    };
  }

  // A number taken by an order started at the same moment: start again.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await forOrganization(organizationId).$transaction(async (tx) => {
        const locked = await lockRows(tx, "product", asked);
        const { planned } = await plan(tx, locked);
        const bySupplier = new Map<string, Planned[]>();
        for (const item of planned) {
          if (!item.supplierId) continue;
          const list = bySupplier.get(item.supplierId) ?? [];
          list.push(item);
          bySupplier.set(item.supplierId, list);
        }
        if (bySupplier.size === 0) {
          return {
            ok: false as const,
            reason: "invalid" as const,
            error:
              "No hay nada que pedir de esos productos: ya está en camino, ya no está bajo o no tienen proveedor.",
          };
        }
        const last = await tx.purchaseOrder.findFirst({
          orderBy: { number: "desc" },
          select: { number: true },
        });
        let number = last?.number ?? 0;
        const orders: Extract<GenerateSuggestedResult, { ok: true }>["orders"] =
          [];
        for (const [supplierId, items] of [...bySupplier.entries()].sort(
          (a, b) =>
            (a[1][0]!.supplierName ?? "").localeCompare(
              b[1][0]!.supplierName ?? "",
              "es",
            ),
        )) {
          // An order holds a limited number of lines: the rest goes in
          // another draft for the same supplier.
          for (
            let start = 0;
            start < items.length;
            start += PURCHASE_ORDER_MAX_LINES
          ) {
            const chunk = items.slice(start, start + PURCHASE_ORDER_MAX_LINES);
            number += 1;
            const orderId = newId();
            try {
              await tx.purchaseOrder.create({
                data: {
                  id: orderId,
                  organizationId,
                  number,
                  contactId: supplierId,
                  notes: "Sugerida desde mínimos.",
                  createdByUserId: userId,
                },
              });
            } catch (error) {
              if ((error as { code?: string }).code === "P2002") {
                throw new NumberTaken();
              }
              throw error;
            }
            await writeLines(tx, organizationId, orderId, chunk, withCosts);
            const supplierName = chunk[0]!.supplierName ?? "";
            await recordAuditEvent(tx, {
              organizationId,
              actorUserId: userId,
              action: "purchase_order.created",
              target: { type: "purchase_order", id: orderId },
              metadata: {
                orden: formatOrderNumber(number),
                proveedor: supplierName,
                origen: "sugerencia desde mínimos",
                productos: chunk.length,
              },
            });
            orders.push({
              orderId,
              numberText: formatOrderNumber(number),
              supplierName,
              lines: chunk.length,
            });
          }
        }
        const products = (n: number) =>
          n === 1 ? "1 producto" : `${n} productos`;
        return {
          ok: true as const,
          orders,
          summary:
            orders.length === 1
              ? `Se creó el borrador ${orders[0]!.numberText} para ${orders[0]!.supplierName} con ${products(orders[0]!.lines)}. Revísalo antes de confirmarlo.`
              : `Se crearon ${orders.length} borradores: ${orders.map((order) => `${order.numberText} (${order.supplierName})`).join(", ")}. Revísalos antes de confirmarlos.`,
        };
      }, LOCKING_TRANSACTION);
    } catch (error) {
      if (error instanceof NumberTaken) continue;
      throw error;
    }
  }
  throw new Error("Could not number the suggested orders");
}

/** The lines of a suggested draft, converted with the content in force. */
async function writeLines(
  tx: Tx,
  organizationId: string,
  orderId: string,
  items: Planned[],
  withCosts: boolean,
) {
  const links = await tx.productSupplier.findMany({
    where: {
      productId: { in: items.map((item) => item.productId) },
      contactId: items[0]!.supplierId!,
    },
    select: { productId: true, supplierSku: true },
  });
  const skuOf = new Map(links.map((row) => [row.productId, row.supplierSku]));
  const data = [];
  for (const [index, item] of items.entries()) {
    const quantity = item.quantity.toString();
    const resolved = await resolveConversion(
      tx,
      item.productId,
      item.presentationId
        ? {
            kind: "presentation",
            quantity,
            presentationId: item.presentationId,
          }
        : { kind: "base", quantity },
    );
    // The plan used the same catalog under the same locks.
    if (!resolved.ok)
      throw new Error(`Suggestion not convertible: ${resolved.error}`);
    const { conversion, product } = resolved;
    data.push({
      id: newId(),
      organizationId,
      orderId,
      lineNumber: index + 1,
      productId: item.productId,
      supplierSku: skuOf.get(item.productId) ?? null,
      capturedQuantity: conversion.capturedQuantity.toString(),
      presentationId: conversion.presentation?.id ?? null,
      presentationVersionId: conversion.presentation?.versionId ?? null,
      factor: conversion.factor.toString(),
      baseQuantity: conversion.baseQuantity.toString(),
      unitCode: product.unitCode,
      unitCost: withCosts ? item.lastCost : null,
    });
  }
  await tx.purchaseOrderLine.createMany({ data });
}

/** Whether the person may record costs: never an error, just yes or no. */
async function mayRecordCosts(actor: PurchasingActor): Promise<boolean> {
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "purchasing.cost.record",
    );
    return true;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return false;
    throw error;
  }
}
