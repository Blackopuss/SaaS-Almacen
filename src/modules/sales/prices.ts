import "server-only";

import { dec, newId } from "@/lib";
import { mayReadInventoryCosts } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { getUnit } from "@/platform/catalog";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import {
  PRICE_FORMAT_ERROR,
  effectivePrice,
  formatMoney,
  parsePrice,
} from "./pricing";

/**
 * Sale prices of a product (VEN-03, ADR 0030): one for its unit and, when
 * wanted, one for each presentation. Reading them is for everyone with
 * `sales.price.read`; the margin over the average cost comes only for who
 * may see costs, and is absent for the rest.
 */

export type SalesActor = { organizationId: string; userId: string };

export type PriceRow = {
  /** Null for the product's unit. */
  presentationId: string | null;
  /** «Pieza», «Caja = 500 piezas». */
  label: string;
  /** Units of the product it holds: "1" for the unit. */
  factor: string;
  /** Its own price, «500.00»; null when it has none. */
  price: string | null;
  /** What it sells at, «$500.00»; null when nothing is known. */
  sellsAt: string | null;
  /** It sells at content × unit price, not at its own. */
  derived: boolean;
  /**
   * Gain over the average cost, «$50.00 (10 %)». Present only for who may
   * see costs, and only when price and cost are both known.
   */
  margin?: string | null;
};

export type ProductPrices = {
  productId: string;
  rows: PriceRow[];
};

/** Prices of a product; null when it does not exist in the company. */
export async function getSalePrices(
  actor: SalesActor,
  productId: string,
): Promise<ProductPrices | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.price.read",
  );
  const client = forOrganization(actor.organizationId);
  const id = String(productId).slice(0, 36);
  const [product, withCosts] = await Promise.all([
    client.product.findFirst({
      where: { id },
      select: {
        id: true,
        unitCode: true,
        salePrices: { select: { presentationId: true, price: true } },
        presentations: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            versions: {
              orderBy: { version: "desc" },
              take: 1,
              select: { factor: true },
            },
          },
        },
      },
    }),
    mayReadInventoryCosts(actor),
  ]);
  if (!product) return null;
  const cost = withCosts
    ? await client.productCost.findFirst({
        where: { productId: product.id },
        select: { averageCost: true },
      })
    : null;

  const unit = getUnit(product.unitCode);
  const own = new Map(
    product.salePrices.map((row) => [
      row.presentationId ?? "",
      row.price.toFixed(2),
    ]),
  );
  const unitPrice = own.get("") ?? null;
  const row = (
    presentationId: string | null,
    label: string,
    factor: string,
  ): PriceRow => {
    const price = own.get(presentationId ?? "") ?? null;
    const sells = effectivePrice(price, unitPrice, factor);
    const result: PriceRow = {
      presentationId,
      label,
      factor,
      price,
      sellsAt: sells ? formatMoney(sells) : null,
      derived: price === null && sells !== null,
    };
    if (withCosts) {
      if (sells && cost) {
        const costOf = dec(cost.averageCost.toString()).times(factor);
        const gain = sells.minus(costOf);
        const percent = sells.isZero()
          ? null
          : gain.dividedBy(sells).times(100).toDecimalPlaces(0);
        result.margin = `${formatMoney(gain)}${percent === null ? "" : ` (${percent.toString()} %)`}`;
      } else {
        result.margin = null;
      }
    }
    return result;
  };
  return {
    productId: product.id,
    rows: [
      row(null, unit.name.charAt(0).toUpperCase() + unit.name.slice(1), "1"),
      ...product.presentations
        .filter((presentation) => presentation.versions.length > 0)
        .map((presentation) => {
          const factor = presentation.versions[0]!.factor.toString();
          return row(
            presentation.id,
            `${presentation.name} = ${dec(factor).toString()} ${dec(factor).equals(1) ? unit.name : unit.plural}`,
            factor,
          );
        }),
    ],
  };
}

export type SetPricesInput = {
  /** Price of the unit as typed; empty = none. */
  unitPrice: string;
  /** Price of each presentation by id, as typed; empty = content × unit. */
  presentations: Record<string, string>;
};

export type SetPricesResult =
  | { ok: true; changed: number }
  | {
      ok: false;
      reason: "invalid" | "not_found";
      /** Problem of each field: "unit" or a presentation id. */
      fieldErrors: Record<string, string>;
      formError?: string;
    };

/**
 * Sets the prices of a product at once. Under the product's lock, so two
 * people saving at the same time end with one of the two complete lists.
 */
export async function setSalePrices(
  actor: SalesActor,
  productId: string,
  input: SetPricesInput,
): Promise<SetPricesResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.price.update",
  );
  const fieldErrors: Record<string, string> = {};
  const read = (key: string, text: unknown): string | null | undefined => {
    const value = String(text ?? "").trim();
    if (value === "") return null;
    const price = parsePrice(value);
    if (price === null) {
      fieldErrors[key] = PRICE_FORMAT_ERROR;
      return undefined;
    }
    return price;
  };
  const wanted = new Map<string, string | null>();
  const unitPrice = read("unit", input.unitPrice);
  if (unitPrice !== undefined) wanted.set("", unitPrice);
  for (const [presentationId, text] of Object.entries(
    input.presentations ?? {},
  ).slice(0, 50)) {
    const key = String(presentationId).slice(0, 36);
    const price = read(key, text);
    if (price !== undefined) wanted.set(key, price);
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "invalid", fieldErrors };
  }

  return forOrganization(actor.organizationId).$transaction(async (tx) => {
    const [locked] = await lockRows(tx, "product", [
      String(productId).slice(0, 36),
    ]);
    const product = locked
      ? await tx.product.findFirst({
          where: { id: locked },
          select: {
            id: true,
            sku: true,
            presentations: { select: { id: true } },
            salePrices: {
              select: { id: true, presentationId: true, price: true },
            },
          },
        })
      : null;
    if (!product) {
      return {
        ok: false as const,
        reason: "not_found" as const,
        fieldErrors: {},
        formError: "Este producto ya no existe.",
      };
    }
    const presentations = new Set(product.presentations.map((p) => p.id));
    const current = new Map(
      product.salePrices.map((row) => [row.presentationId ?? "", row]),
    );
    const changes: string[] = [];
    for (const [key, price] of wanted) {
      // A presentation of another product is not a field of this form.
      if (key !== "" && !presentations.has(key)) continue;
      const before = current.get(key);
      if (price === null) {
        if (before) {
          await tx.salePrice.deleteMany({ where: { id: before.id } });
          changes.push(`${key || "unidad"}: sin precio`);
        }
      } else if (!before) {
        await tx.salePrice.create({
          data: {
            id: newId(),
            organizationId: actor.organizationId,
            productId: product.id,
            presentationId: key || null,
            price,
            updatedByUserId: actor.userId,
          },
        });
        changes.push(`${key || "unidad"}: ${price}`);
      } else if (before.price.toFixed(2) !== price) {
        await tx.salePrice.updateMany({
          where: { id: before.id },
          data: { price, updatedByUserId: actor.userId },
        });
        changes.push(
          `${key || "unidad"}: ${before.price.toFixed(2)} → ${price}`,
        );
      }
    }
    if (changes.length > 0) {
      await recordAuditEvent(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "sales.prices_changed",
        target: { type: "product", id: product.id },
        metadata: {
          sku: product.sku,
          cambios: changes.join("; ").slice(0, 500),
        },
      });
    }
    return { ok: true as const, changed: changes.length };
  }, LOCKING_TRANSACTION);
}
