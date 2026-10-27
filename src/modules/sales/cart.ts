import "server-only";

import { Decimal, dec } from "@/lib";
import { formatStock } from "@/modules/inventory";
import { assertModulePermission } from "@/platform/billing";
import { resolveConversion, type Capture } from "@/platform/catalog";
import { forOrganization, type TenantDb } from "@/server";

import { effectivePrice, formatMoney } from "./pricing";
import type { SalesActor } from "./prices";
import { readTaxRule } from "./settings";
import { formatTaxRate, saleTotals } from "./tax";

/**
 * The cart of the counter (VEN-06, ADR 0030): what each line costs and
 * what the sale adds up to, always computed here — the browser only sends
 * products, how they are counted and what was typed. Confirming the sale
 * (VEN-09) prices its lines again with the same rules.
 */

export const SALE_MAX_LINES = 50;

/** A company client or one of its transactions. */
type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export type CartLineInput = {
  productId: string;
  /** "base" (the product's unit) or "p:<presentation id>". */
  capture: string;
  /** As typed: «2.75», «1». */
  quantity: string;
  /** Where it leaves from; empty = the default location. */
  locationId?: string | null;
};

export type PricedLine = {
  productId: string;
  productName: string;
  unitCode: string;
  presentationId: string | null;
  presentationVersionId: string | null;
  factor: Decimal;
  capturedQuantity: Decimal;
  baseQuantity: Decimal;
  /** Price of one captured unit (one box, one meter). */
  unitPrice: Decimal;
  /** capturedQuantity × unitPrice, in cents. */
  amount: Decimal;
};

const cents = (amount: Decimal) =>
  amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Prices each line with the company's prices in force: the presentation's
 * own price, or its content × the unit price. Lines that cannot be sold
 * come back in `lineErrors`, by position.
 */
export async function priceLines(
  client: Client,
  lines: readonly CartLineInput[],
): Promise<{
  priced: (PricedLine | null)[];
  lineErrors: Record<number, string>;
}> {
  const lineErrors: Record<number, string> = {};
  const ids = [...new Set(lines.map((line) => String(line.productId)))];
  const products = new Map(
    (
      await client.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          status: true,
          salePrices: { select: { presentationId: true, price: true } },
        },
      })
    ).map((product) => [product.id, product]),
  );
  const priced: (PricedLine | null)[] = [];
  for (const [index, line] of lines.entries()) {
    const product = products.get(String(line.productId));
    if (!product) {
      lineErrors[index] = "Este producto ya no existe.";
      priced.push(null);
      continue;
    }
    if (product.status !== "ACTIVE") {
      lineErrors[index] = `${product.name} está archivado: no se puede vender.`;
      priced.push(null);
      continue;
    }
    const capture = String(line.capture ?? "base");
    const quantity = String(line.quantity ?? "").trim();
    if (quantity === "") {
      lineErrors[index] = "Escribe la cantidad.";
      priced.push(null);
      continue;
    }
    // A sale is counted in the product's unit or in a presentation: its
    // price is for one of those.
    const parsed: Capture | null =
      capture === "base"
        ? { kind: "base", quantity }
        : capture.startsWith("p:")
          ? { kind: "presentation", quantity, presentationId: capture.slice(2) }
          : null;
    if (!parsed) {
      lineErrors[index] = "Elige en qué se vende: pieza o presentación.";
      priced.push(null);
      continue;
    }
    const conversion = await resolveConversion(client, product.id, parsed);
    if (!conversion.ok) {
      lineErrors[index] = conversion.error;
      priced.push(null);
      continue;
    }
    const c = conversion.conversion;
    const own = new Map(
      product.salePrices.map((row) => [
        row.presentationId ?? "",
        row.price.toString(),
      ]),
    );
    const unitPrice = effectivePrice(
      own.get(c.presentation?.id ?? "") ?? null,
      own.get("") ?? null,
      c.factor,
    );
    if (unitPrice === null) {
      lineErrors[index] =
        `${product.name} no tiene precio de venta. Pide que se lo pongan en Inventario.`;
      priced.push(null);
      continue;
    }
    priced.push({
      productId: product.id,
      productName: product.name,
      unitCode: conversion.product.unitCode,
      presentationId: c.presentation?.id ?? null,
      presentationVersionId: c.presentation?.versionId ?? null,
      factor: c.factor,
      capturedQuantity: c.capturedQuantity,
      baseQuantity: c.baseQuantity,
      unitPrice,
      amount: cents(c.capturedQuantity.times(unitPrice)),
    });
  }
  return { priced, lineErrors };
}

export type CartQuote = {
  lines: {
    /** «$500.00 c/u». */
    unitPrice: string | null;
    /** «$1,000.00». */
    amount: string | null;
    error?: string;
  }[];
  /** Totals of the lines that can be sold. */
  subtotal: string;
  tax: string;
  total: string;
  /** «IVA incluido (16 %)» or «IVA (16 %)». */
  taxLabel: string;
  pricesIncludeTax: boolean;
};

/**
 * What the cart adds up to before confirming. Reads only. Also says when a
 * line asks for more than its location holds, so the cashier knows before
 * charging; confirming checks it again under the locks.
 */
export async function quoteSale(
  actor: SalesActor,
  input: { lines: readonly CartLineInput[] },
): Promise<CartQuote> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.create",
  );
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(
    0,
    SALE_MAX_LINES,
  );
  const client = forOrganization(actor.organizationId);
  const [{ priced, lineErrors }, rule, general] = await Promise.all([
    priceLines(client, lines),
    readTaxRule(client, actor.organizationId),
    client.location.findFirst({
      where: { isDefault: true },
      select: { id: true },
    }),
  ]);

  // Several lines of the same product share what its location holds.
  const where = (index: number) =>
    String(lines[index]?.locationId || general?.id || "");
  const wanted = new Map<string, Decimal>();
  priced.forEach((line, index) => {
    if (!line) return;
    const slot = `${line.productId}|${where(index)}`;
    wanted.set(slot, (wanted.get(slot) ?? dec(0)).plus(line.baseQuantity));
  });
  const balances =
    wanted.size > 0
      ? await client.stockBalance.findMany({
          where: {
            OR: [...wanted.keys()].map((slot) => {
              const [productId, locationId] = slot.split("|");
              return { productId, locationId };
            }),
          },
          select: { productId: true, locationId: true, quantity: true },
        })
      : [];
  const held = new Map(
    balances.map((row) => [
      `${row.productId}|${row.locationId}`,
      dec(row.quantity.toString()),
    ]),
  );
  priced.forEach((line, index) => {
    if (!line) return;
    const slot = `${line.productId}|${where(index)}`;
    const has = held.get(slot) ?? dec(0);
    if (wanted.get(slot)!.greaterThan(has)) {
      lineErrors[index] = has.isZero()
        ? `No hay ${line.productName} en existencia.`
        : `Solo hay ${formatStock(has.toString(), line.unitCode)} de ${line.productName}.`;
    }
  });

  const totals = saleTotals(
    priced.flatMap((line) => (line ? [line.amount] : [])),
    rule,
  );
  return {
    lines: priced.map((line, index) => ({
      unitPrice: line ? formatMoney(line.unitPrice) : null,
      amount: line ? formatMoney(line.amount) : null,
      ...(lineErrors[index] ? { error: lineErrors[index] } : {}),
    })),
    subtotal: formatMoney(totals.subtotal),
    tax: formatMoney(totals.tax),
    total: formatMoney(totals.total),
    taxLabel: rule.pricesIncludeTax
      ? `IVA incluido (${formatTaxRate(rule.rate)})`
      : `IVA (${formatTaxRate(rule.rate)})`,
    pricesIncludeTax: rule.pricesIncludeTax,
  };
}
