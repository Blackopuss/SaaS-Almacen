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
  /** A line may go somewhere else than the rest (CMP-09). */
  lines: { productId: string; capture: Capture; locationId?: string | null }[];
  /** «OC-0007 · Remisión 4411»: what people see in the history. */
  reference: string | null;
  reason: string | null;
};

export type ReceiptEntryLine = {
  lineNumber: number;
  productId: string;
  locationId: string;
  locationName: string;
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
      /** Position of the line with the problem, or null for the location of the receipt. */
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
  // Every location of the receipt at once: lockRows keeps the id order.
  const chosen = [
    ...new Set(
      [input.locationId, ...input.lines.map((line) => line.locationId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  await lockRows(tx, "location", chosen);

  const places = await tx.location.findMany({
    where: { OR: [{ id: { in: chosen } }, { isDefault: true }] },
    select: { id: true, name: true, archivedAt: true, isDefault: true },
  });
  const placeOf = (id: string | null | undefined) =>
    id
      ? places.find((place) => place.id === id)
      : places.find((place) => place.isDefault === true);
  const problemOf = (place: (typeof places)[number] | undefined) =>
    !place
      ? "Esa ubicación ya no existe. Elige otra."
      : place.archivedAt
        ? `«${place.name}» está archivada. Elige otra ubicación.`
        : null;
  const location = placeOf(input.locationId);
  const locationProblem = problemOf(location);
  if (locationProblem || !location) {
    return {
      ok: false,
      line: null,
      error: locationProblem ?? "Esa ubicación ya no existe. Elige otra.",
    };
  }

  const products = await tx.product.findMany({
    where: { id: { in: [...new Set(input.lines.map((l) => l.productId))] } },
    select: { id: true, name: true, sku: true, status: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const lines: ReceiptEntryLine[] = [];
  // What enters each product in each location: `<product> <location>`.
  const added = new Map<string, Decimal>();
  for (const [index, line] of input.lines.entries()) {
    const place = line.locationId ? placeOf(line.locationId) : location;
    const placeProblem = problemOf(place);
    if (placeProblem || !place) {
      return {
        ok: false,
        line: index,
        error: placeProblem ?? "Esa ubicación ya no existe. Elige otra.",
      };
    }
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
    const slot = `${product.id} ${place.id}`;
    added.set(slot, (added.get(slot) ?? dec(0)).plus(base));
    lines.push({
      lineNumber: index + 1,
      productId: product.id,
      locationId: place.id,
      locationName: place.name,
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
    where: {
      productId: { in: [...new Set(lines.map((line) => line.productId))] },
      locationId: { in: [...new Set(lines.map((line) => line.locationId))] },
    },
    select: { id: true, productId: true, locationId: true, quantity: true },
  });
  const current = new Map(
    balances.map((row) => [`${row.productId} ${row.locationId}`, row]),
  );
  for (const [slot, quantity] of added) {
    const before = dec(current.get(slot)?.quantity.toString() ?? 0);
    if (before.plus(quantity).greaterThan(MAX_BALANCE)) {
      return {
        ok: false,
        line: lines.findIndex(
          (line) => `${line.productId} ${line.locationId}` === slot,
        ),
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
      locationId: line.locationId,
      direction: "IN" as const,
      capturedQuantity: line.capturedQuantity.toString(),
      presentationId: line.presentationId,
      presentationVersionId: line.presentationVersionId,
      factor: line.factor.toString(),
      baseQuantity: line.baseQuantity.toString(),
      unitCode: line.unitCode,
    })),
  });
  for (const [slot, quantity] of added) {
    const row = current.get(slot);
    const [productId, locationId] = slot.split(" ") as [string, string];
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
          locationId,
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
