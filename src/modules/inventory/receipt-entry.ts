import "server-only";

import { dec, newId } from "@/lib";
import { resolveConversion, type Capture } from "@/platform/catalog";
import { lockRows, type TenantDb } from "@/server";

import { MAX_BALANCE, formatStock, type InventoryActor } from "./movements";

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Decimal = ReturnType<typeof dec>;

/**
 * The entry of stock of a purchase receipt (CMP-07): the movement
 * (`RECEIPT`), its lines and the balances, written inside the transaction
 * of the receipt so that the document and the stock exist together or not
 * at all. Compras calls it after checking its own permission
 * (`purchasing.receipt.create`): receiving does not need the permission of
 * manual entries, nor grants it (matrix, «efectos entre módulos»).
 *
 * Like every movement, it takes the locks of its products and then of the
 * location (the caller may have taken them already: taking them again is
 * harmless) and converts each capture with the content in force now.
 */
export type ReceiptEntryInput = {
  /** Where it is put; null = the default location, «General». */
  locationId: string | null;
  lines: { productId: string; capture: Capture }[];
  /** «OC-0007 · Remisión 4411»: what people see in the history. */
  reference: string | null;
  reason: string | null;
};

export type ReceiptEntryLine = {
  lineNumber: number;
  productId: string;
  unitCode: string;
  capturedQuantity: Decimal;
  presentationId: string | null;
  presentationVersionId: string | null;
  factor: Decimal;
  baseQuantity: Decimal;
  /** «3 cajas × 100 = 300 piezas», or «25 piezas». */
  text: string;
};

export type ReceiptEntryResult =
  | {
      ok: true;
      movementId: string;
      locationId: string;
      locationName: string;
      lines: ReceiptEntryLine[];
    }
  | {
      ok: false;
      /** Position of the line with the problem, or null for the location. */
      line: number | null;
      error: string;
    };

export async function postReceiptEntry(
  tx: Tx,
  actor: InventoryActor,
  input: ReceiptEntryInput,
): Promise<ReceiptEntryResult> {
  const { organizationId, userId } = actor;
  if (input.lines.length === 0) {
    return { ok: false, line: null, error: "No hay nada que recibir." };
  }
  await lockRows(
    tx,
    "product",
    input.lines.map((line) => line.productId),
  );
  if (input.locationId) await lockRows(tx, "location", [input.locationId]);

  const location = await tx.location.findFirst({
    where: input.locationId ? { id: input.locationId } : { isDefault: true },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!location) {
    return {
      ok: false,
      line: null,
      error: "Esa ubicación ya no existe. Elige otra.",
    };
  }
  if (location.archivedAt) {
    return {
      ok: false,
      line: null,
      error: `«${location.name}» está archivada. Elige otra ubicación.`,
    };
  }

  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(input.lines.map((l) => l.productId))] } },
    select: { id: true, name: true, sku: true, status: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const lines: ReceiptEntryLine[] = [];
  const added = new Map<string, Decimal>();
  for (const [index, line] of input.lines.entries()) {
    const product = byId.get(line.productId);
    if (!product) {
      return { ok: false, line: index, error: "Este producto ya no existe." };
    }
    if (product.status !== "ACTIVE") {
      return {
        ok: false,
        line: index,
        error: `${product.name} (${product.sku}) está archivado. Reactívalo para recibirlo.`,
      };
    }
    // The content in force now: what entered is what the box holds today.
    const resolved = await resolveConversion(tx, product.id, line.capture);
    if (!resolved.ok) {
      return {
        ok: false,
        line: index,
        error: `${product.name}: ${resolved.error}`,
      };
    }
    const { conversion } = resolved;
    const base = conversion.baseQuantity;
    added.set(product.id, (added.get(product.id) ?? dec(0)).plus(base));
    lines.push({
      lineNumber: index + 1,
      productId: product.id,
      unitCode: resolved.product.unitCode,
      capturedQuantity: conversion.capturedQuantity,
      presentationId: conversion.presentation?.id ?? null,
      presentationVersionId: conversion.presentation?.versionId ?? null,
      factor: conversion.factor,
      baseQuantity: base,
      text: conversion.presentation
        ? conversion.preview
        : formatStock(base.toString(), resolved.product.unitCode),
    });
  }

  const balances = await tx.stockBalance.findMany({
    where: { productId: { in: [...added.keys()] }, locationId: location.id },
    select: { id: true, productId: true, quantity: true },
  });
  const current = new Map(balances.map((row) => [row.productId, row]));
  for (const [productId, quantity] of added) {
    const before = dec(current.get(productId)?.quantity.toString() ?? 0);
    if (before.plus(quantity).greaterThan(MAX_BALANCE)) {
      return {
        ok: false,
        line: input.lines.findIndex((line) => line.productId === productId),
        error:
          "Con esa cantidad el saldo sería demasiado grande. Revisa lo recibido.",
      };
    }
  }

  const movementId = newId();
  await tx.stockMovement.create({
    data: {
      id: movementId,
      organizationId,
      type: "RECEIPT",
      reason: input.reason,
      reference: input.reference,
      createdByUserId: userId,
    },
  });
  await tx.stockMovementLine.createMany({
    data: lines.map((line) => ({
      id: newId(),
      organizationId,
      movementId,
      lineNumber: line.lineNumber,
      productId: line.productId,
      locationId: location.id,
      direction: "IN" as const,
      capturedQuantity: line.capturedQuantity.toString(),
      presentationId: line.presentationId,
      presentationVersionId: line.presentationVersionId,
      factor: line.factor.toString(),
      baseQuantity: line.baseQuantity.toString(),
      unitCode: line.unitCode,
    })),
  });
  for (const [productId, quantity] of added) {
    const row = current.get(productId);
    if (row) {
      await tx.stockBalance.updateMany({
        where: { id: row.id },
        data: { quantity: { increment: quantity.toString() } },
      });
    } else {
      await tx.stockBalance.create({
        data: {
          id: newId(),
          organizationId,
          productId,
          locationId: location.id,
          quantity: quantity.toString(),
        },
      });
    }
  }
  return {
    ok: true,
    movementId,
    locationId: location.id,
    locationName: location.name,
    lines,
  };
}
