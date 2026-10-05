import "server-only";

import { z } from "zod";

import { dec, formatDecimal, newId } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { getUnit, resolveConversion } from "@/platform/catalog";
import { compareLocationNames, formatLocationPath } from "@/platform/locations";
import { forOrganization, lockRows } from "@/server";

/**
 * Stock movements (INV-16 on). A confirmation writes the movement, its
 * lines and the balances in one transaction: all of it exists or none.
 *
 * Every movement locks its products first (`lockRows`), so everything
 * that changes the stock of a product happens one after the other: the
 * balance each one reads is the one the previous left.
 */

/** Who is acting; always taken from the session, never from the form. */
export type InventoryActor = { organizationId: string; userId: string };

/** A balance beyond this is a mistake, not stock. */
const MAX_BALANCE = "999999999999.999";

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .regex(
      /^[^\u0000-\u001f\u007f]*$/,
      "Quita los saltos de línea o tabuladores.",
    )
    .max(max, tooLong)
    .optional()
    .transform((value) => (value ? value : null));

const entrySchema = z.object({
  productId: z.string().trim().min(1, "Elige un producto.").max(36),
  /** Empty = the default location, «General». */
  locationId: z
    .string()
    .trim()
    .max(36)
    .optional()
    .transform((value) => value || null),
  quantity: z.string().trim().min(1, "Escribe la cantidad que entra."),
  reference: optionalText(
    120,
    "La referencia es demasiado larga (máximo 120 caracteres).",
  ),
  reason: optionalText(
    500,
    "La nota es demasiado larga (máximo 500 caracteres).",
  ),
});

export type EntryInput = z.input<typeof entrySchema>;
export type EntryField = keyof EntryInput;

export type MovementResult =
  | {
      ok: true;
      movementId: string;
      /** «Entraron 25 piezas de Tornillo a General. Ahora hay 325 piezas ahí.» */
      summary: string;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_allowed";
      fieldErrors: Partial<Record<EntryField, string>>;
      formError?: string;
    };

type Failure = Extract<MovementResult, { ok: false }>;

/** Carries an expected failure out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("movement rejected");
  }
}

const reject = (
  reason: Failure["reason"],
  field: EntryField | null,
  error: string,
): never => {
  throw new Rejected({
    ok: false,
    reason,
    fieldErrors: field ? { [field]: error } : {},
    formError: field ? undefined : error,
  });
};

/** «25 piezas», «2.75 metros», with thousands separators. */
export function formatStock(quantity: string, unitCode: string): string {
  const unit = getUnit(unitCode);
  const value = dec(quantity);
  return `${formatDecimal(value)} ${value.equals(1) ? unit.name : unit.plural}`;
}

/**
 * Registers stock that arrives, captured in the product's own unit
 * (INV-16). The movement and the balance are written together.
 */
export async function registerEntry(
  actor: InventoryActor,
  input: EntryInput,
): Promise<MovementResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.entry.create",
  );

  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<EntryField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as EntryField;
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, reason: "invalid", fieldErrors };
  }
  const data = parsed.data;

  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      // From here on, nobody else moves this product until we finish.
      const [productId] = await lockRows(tx, "product", [data.productId]);
      const product = productId
        ? await tx.product.findFirst({
            where: { id: productId },
            select: { id: true, name: true, status: true },
          })
        : null;
      if (!product) {
        return reject("not_found", "productId", "Este producto ya no existe.");
      }
      if (product.status !== "ACTIVE") {
        return reject(
          "not_allowed",
          "productId",
          "Este producto está archivado. Reactívalo para registrar entradas.",
        );
      }

      const location = await tx.location.findFirst({
        where: data.locationId ? { id: data.locationId } : { isDefault: true },
        select: { id: true, name: true, archivedAt: true },
      });
      if (!location) {
        return reject(
          "not_found",
          "locationId",
          "Esa ubicación ya no existe. Elige otra.",
        );
      }
      if (location.archivedAt) {
        return reject(
          "not_allowed",
          "locationId",
          `«${location.name}» está archivada. Elige otra ubicación.`,
        );
      }

      // The quantity is validated with the rule of the product: nothing is
      // rounded and the factor never comes from the browser (INV-09).
      const resolved = await resolveConversion(tx, product.id, {
        kind: "base",
        quantity: data.quantity,
      });
      if (!resolved.ok) return reject("invalid", "quantity", resolved.error);
      const { conversion } = resolved;
      const unitCode = resolved.product.unitCode;

      const current = await tx.stockBalance.findFirst({
        where: { productId: product.id, locationId: location.id },
        select: { id: true, quantity: true },
      });
      const balance = dec(current?.quantity.toString() ?? 0).plus(
        conversion.baseQuantity,
      );
      if (balance.greaterThan(MAX_BALANCE)) {
        return reject(
          "invalid",
          "quantity",
          "Con esa cantidad el saldo sería demasiado grande. Revisa lo que escribiste.",
        );
      }

      const movementId = newId();
      await tx.stockMovement.create({
        data: {
          id: movementId,
          organizationId,
          type: "ENTRY",
          reason: data.reason,
          reference: data.reference,
          createdByUserId: userId,
        },
      });
      await tx.stockMovementLine.create({
        data: {
          id: newId(),
          organizationId,
          movementId,
          lineNumber: 1,
          productId: product.id,
          locationId: location.id,
          direction: "IN",
          capturedQuantity: conversion.capturedQuantity.toString(),
          capturedUnitCode: conversion.capturedUnitCode,
          presentationId: conversion.presentation?.id ?? null,
          presentationVersionId: conversion.presentation?.versionId ?? null,
          factor: conversion.factor.toString(),
          baseQuantity: conversion.baseQuantity.toString(),
          unitCode,
        },
      });
      if (current) {
        await tx.stockBalance.updateMany({
          where: { id: current.id },
          data: { quantity: { increment: conversion.baseQuantity.toString() } },
        });
      } else {
        await tx.stockBalance.create({
          data: {
            id: newId(),
            organizationId,
            productId: product.id,
            locationId: location.id,
            quantity: conversion.baseQuantity.toString(),
          },
        });
      }

      const entered = formatStock(conversion.baseQuantity.toString(), unitCode);
      const verb = conversion.baseQuantity.equals(1) ? "Entró" : "Entraron";
      return {
        ok: true as const,
        movementId,
        summary: `${verb} ${entered} de ${product.name} a ${location.name}. Ahora hay ${formatStock(balance.toString(), unitCode)} ahí.`,
      };
    });
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

/** Total stock of each product (the sum of its locations), in its unit. */
export async function getStockTotals(
  actor: InventoryActor,
  productIds: readonly string[],
): Promise<Record<string, string>> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.stock.read",
  );
  const ids = [...new Set(productIds.map(String))].slice(0, 500);
  if (ids.length === 0) return {};
  const sums = await forOrganization(actor.organizationId).stockBalance.groupBy(
    {
      by: ["productId"],
      where: { productId: { in: ids } },
      _sum: { quantity: true },
    },
  );
  return Object.fromEntries(
    sums.map((row) => [row.productId, (row._sum.quantity ?? 0).toString()]),
  );
}

/** Stock of one product in each location where it has any, by location id. */
export async function getStockByLocation(
  actor: InventoryActor,
  productId: string,
): Promise<Record<string, string>> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.stock.read",
  );
  const rows = await forOrganization(
    actor.organizationId,
  ).stockBalance.findMany({
    where: { productId: String(productId), quantity: { gt: 0 } },
    take: 2_000,
    select: { locationId: true, quantity: true },
  });
  return Object.fromEntries(
    rows.map((row) => [row.locationId, row.quantity.toString()]),
  );
}

export const MOVEMENT_TYPE_LABELS = {
  ENTRY: "Entrada",
  EXIT: "Salida",
  TRANSFER: "Reubicación",
  ADJUSTMENT: "Ajuste",
  INITIAL: "Saldo inicial",
  REVERSAL: "Reversa",
} as const;

export type MovementType = keyof typeof MOVEMENT_TYPE_LABELS;

export type MovementSummary = {
  id: string;
  type: MovementType;
  typeLabel: string;
  createdAt: Date;
  /** Null when the account no longer belongs to the company. */
  authorName: string | null;
  reference: string | null;
  reason: string | null;
  lines: {
    productId: string;
    productName: string;
    sku: string;
    /** «Zona A › Estante 3». */
    location: string;
    direction: "IN" | "OUT";
    /** In the product's unit: «300 piezas». */
    quantity: string;
  }[];
};

/**
 * Latest movements of the company, newest first. The history with filters
 * arrives with INV-27; `movementId` asks for one in particular.
 */
export async function listRecentMovements(
  actor: InventoryActor,
  options: { limit?: number; movementId?: string } = {},
): Promise<MovementSummary[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.movement.read",
  );
  const client = forOrganization(actor.organizationId);
  const movements = await client.stockMovement.findMany({
    where: options.movementId ? { id: String(options.movementId) } : {},
    // Ids are UUIDv7: their order is the order of creation.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(options.limit ?? 20, 1), 50),
    select: {
      id: true,
      type: true,
      createdAt: true,
      createdByUserId: true,
      reference: true,
      reason: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          productId: true,
          locationId: true,
          direction: true,
          baseQuantity: true,
          unitCode: true,
          product: { select: { name: true, sku: true } },
        },
      },
    },
  });
  if (movements.length === 0) return [];

  const [members, locations] = await Promise.all([
    client.membership.findMany({
      where: {
        userId: { in: [...new Set(movements.map((m) => m.createdByUserId))] },
      },
      select: { userId: true, user: { select: { name: true } } },
    }),
    client.location.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              movements.flatMap((m) => m.lines.map((l) => l.locationId)),
            ),
          ],
        },
      },
      select: {
        id: true,
        name: true,
        parent: {
          select: { name: true, parent: { select: { name: true } } },
        },
      },
    }),
  ]);
  const names = new Map(members.map((m) => [m.userId, m.user.name]));
  const paths = new Map(
    locations.map((location) => [
      location.id,
      formatLocationPath(
        [
          location.parent?.parent?.name,
          location.parent?.name,
          location.name,
        ].filter((name): name is string => Boolean(name)),
      ),
    ]),
  );

  return movements.map((movement) => ({
    id: movement.id,
    type: movement.type,
    typeLabel: MOVEMENT_TYPE_LABELS[movement.type],
    createdAt: movement.createdAt,
    authorName: names.get(movement.createdByUserId) ?? null,
    reference: movement.reference,
    reason: movement.reason,
    lines: movement.lines.map((line) => ({
      productId: line.productId,
      productName: line.product.name,
      sku: line.product.sku,
      location: paths.get(line.locationId) ?? "",
      direction: line.direction,
      quantity: formatStock(line.baseQuantity.toString(), line.unitCode),
    })),
  }));
}

/** Locations where stock can be received, in reading order, with their path. */
export async function listStockLocations(
  actor: InventoryActor,
): Promise<{ id: string; path: string; isDefault: boolean }[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.location.read",
  );
  const rows = await forOrganization(actor.organizationId).location.findMany({
    where: { archivedAt: null },
    take: 1_000,
    select: {
      id: true,
      name: true,
      isDefault: true,
      parent: { select: { name: true, parent: { select: { name: true } } } },
    },
  });
  return rows
    .map((row) => ({
      id: row.id,
      isDefault: row.isDefault === true,
      path: formatLocationPath(
        [row.parent?.parent?.name, row.parent?.name, row.name].filter(
          (name): name is string => Boolean(name),
        ),
      ),
    }))
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        compareLocationNames(a.path, b.path),
    );
}
