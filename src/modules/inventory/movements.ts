import "server-only";

import { z } from "zod";

import { dec, formatDecimal, newId } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import {
  getUnit,
  pluralizeName,
  resolveConversion,
  type Capture,
} from "@/platform/catalog";
import { compareLocationNames, formatLocationPath } from "@/platform/locations";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

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

/** Random text chosen by whoever shows the form: a UUID fits. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

const KEY_REUSED =
  "Esta confirmación ya se usó para otro movimiento. Recarga la página para registrar uno nuevo.";

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
  /**
   * How the quantity was captured (INV-17): a presentation of the product
   * («3 cajas») or another unit of the same kind («275 centímetros»).
   * Neither = the product's own unit. Only the id or the code travels: the
   * content of the presentation is always read here, never received.
   */
  presentationId: z
    .string()
    .trim()
    .max(36)
    .optional()
    .transform((value) => value || null),
  unitCode: z
    .string()
    .trim()
    .max(12)
    .optional()
    .transform((value) => value || null),
  reference: optionalText(
    120,
    "La referencia es demasiado larga (máximo 120 caracteres).",
  ),
  reason: optionalText(
    500,
    "La nota es demasiado larga (máximo 500 caracteres).",
  ),
  /**
   * Key of this confirmation (INV-21), created when the form is shown and
   * sent again on every retry: the same key never writes a second
   * movement. Without it there is no protection against repeats.
   */
  idempotencyKey: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || null)
    .refine((value) => value === null || IDEMPOTENCY_KEY.test(value), {
      message:
        "No pudimos identificar esta confirmación. Recarga la página e inténtalo de nuevo.",
    }),
});

export type EntryInput = z.input<typeof entrySchema>;
export type EntryField = keyof EntryInput;

export type MovementResult =
  | {
      ok: true;
      movementId: string;
      /** «Entraron 25 piezas de Tornillo a General. Ahora hay 325 piezas ahí.» */
      summary: string;
      /**
       * The confirmation had already been registered (a retry): nothing
       * was written now and `movementId` is the original movement.
       */
      repeated?: true;
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
 * (INV-16), in one of its presentations or in another unit of the same
 * kind (INV-17). The movement and the balance are written together.
 */
export async function registerEntry(
  actor: InventoryActor,
  input: EntryInput,
): Promise<MovementResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.entry.create",
  );
  return post(actor, input, "ENTRY");
}

/**
 * Registers what there already was of a product when the business started
 * using the system (INV-18). It is a movement like any other — the balance
 * is never typed in — with two rules of its own: it comes before any other
 * movement of the product, and each location gets it once. Later
 * differences are corrected with an adjustment.
 */
export async function registerInitialBalance(
  actor: InventoryActor,
  input: EntryInput,
): Promise<MovementResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.opening.create",
  );
  return post(actor, input, "INITIAL");
}

/**
 * Registers stock that leaves a location (INV-19). It never takes more
 * than the location holds: stock does not go below zero (MOV-01).
 */
export async function registerExit(
  actor: InventoryActor,
  input: EntryInput,
): Promise<MovementResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.exit.create",
  );
  return post(actor, input, "EXIT");
}

/** Texts that change with the kind of movement. */
const KINDS = {
  ENTRY: {
    direction: "IN",
    missingQuantity: "Escribe la cantidad que entra.",
    archived:
      "Este producto está archivado. Reactívalo para registrar entradas.",
  },
  INITIAL: {
    direction: "IN",
    missingQuantity: "Escribe cuánto hay.",
    archived:
      "Este producto está archivado. Reactívalo para registrar su saldo inicial.",
  },
  EXIT: {
    direction: "OUT",
    missingQuantity: "Escribe la cantidad que sale.",
    archived:
      "Este producto está archivado. Reactívalo para registrar salidas.",
  },
} as const;

/**
 * One product, one location, in or out: the movement, its line and the
 * balance, in one transaction. Callers have checked the permission.
 */
async function post(
  actor: InventoryActor,
  input: EntryInput,
  type: keyof typeof KINDS,
): Promise<MovementResult> {
  const { organizationId, userId } = actor;
  const kind = KINDS[type];

  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<EntryField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as EntryField;
      fieldErrors[field] ??=
        field === "quantity" && issue.code === "too_small"
          ? kind.missingQuantity
          : issue.message;
    }
    // The key has no field in the form: its problem goes to the top.
    const { idempotencyKey: keyProblem, ...rest } = fieldErrors;
    return {
      ok: false,
      reason: "invalid",
      fieldErrors: rest,
      formError: keyProblem,
    };
  }
  const data = parsed.data;
  if (data.presentationId && data.unitCode) {
    return {
      ok: false,
      reason: "invalid",
      fieldErrors: {
        quantity: "Elige una sola forma de capturar: presentación o unidad.",
      },
    };
  }
  const capture: Capture = data.presentationId
    ? {
        kind: "presentation",
        quantity: data.quantity,
        presentationId: data.presentationId,
      }
    : data.unitCode
      ? { kind: "unit", quantity: data.quantity, unitCode: data.unitCode }
      : { kind: "base", quantity: data.quantity };

  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      // From here on, nobody else moves this product until we finish.
      const [productId] = await lockRows(tx, "product", [data.productId]);
      // Archiving a location locks its row first, so it cannot be archived
      // between our check and the balance we write (INV-19B). «General»
      // is never archived and needs no lock.
      if (data.locationId) await lockRows(tx, "location", [data.locationId]);

      // A retry of a confirmation that already went through answers with
      // the movement it wrote, before any other check: by now the stock or
      // the product may have changed because of that very movement.
      if (data.idempotencyKey) {
        const replay = await findReplay(tx, data.idempotencyKey);
        if (replay) return answerReplay(replay, type, userId, data);
      }
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
        return reject("not_allowed", "productId", kind.archived);
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
      const resolved = await resolveConversion(tx, product.id, capture);
      if (!resolved.ok) return reject("invalid", "quantity", resolved.error);
      const { conversion } = resolved;
      const unitCode = resolved.product.unitCode;
      const base = conversion.baseQuantity;
      const how =
        conversion.presentation || conversion.capturedUnitCode
          ? ` (${conversion.preview})`
          : "";

      if (type === "INITIAL") {
        // The product is locked: what we read here cannot change under us.
        const earlier = await tx.stockMovementLine.findMany({
          where: { productId: product.id },
          take: 500,
          select: { locationId: true, movement: { select: { type: true } } },
        });
        if (earlier.some((line) => line.movement.type !== "INITIAL")) {
          return reject(
            "not_allowed",
            "productId",
            "Este producto ya tiene movimientos: su saldo inicial ya no se captura. Usa una entrada, o un ajuste si la cantidad no coincide.",
          );
        }
        if (earlier.some((line) => line.locationId === location.id)) {
          return reject(
            "not_allowed",
            "locationId",
            `Ya capturaste el saldo inicial de este producto en «${location.name}». Elige otra ubicación.`,
          );
        }
      }

      const current = await tx.stockBalance.findFirst({
        where: { productId: product.id, locationId: location.id },
        select: { id: true, quantity: true },
      });
      const before = dec(current?.quantity.toString() ?? 0);
      const balance =
        kind.direction === "IN" ? before.plus(base) : before.minus(base);
      if (balance.isNegative()) {
        // MOV-01: a location never gives more than it holds.
        return reject(
          "invalid",
          "quantity",
          before.isZero()
            ? `No hay existencias de ${product.name} en ${location.name}.`
            : `Solo hay ${formatStock(before.toString(), unitCode)} en ${location.name}: no pueden salir ${formatStock(base.toString(), unitCode)}.`,
        );
      }
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
          type,
          reason: data.reason,
          reference: data.reference,
          idempotencyKey: data.idempotencyKey,
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
          direction: kind.direction,
          capturedQuantity: conversion.capturedQuantity.toString(),
          capturedUnitCode: conversion.capturedUnitCode,
          presentationId: conversion.presentation?.id ?? null,
          presentationVersionId: conversion.presentation?.versionId ?? null,
          factor: conversion.factor.toString(),
          baseQuantity: base.toString(),
          unitCode,
        },
      });
      if (kind.direction === "OUT") {
        // The condition repeats the check in the same statement that
        // changes the balance; the CHECK of the table is the last defense.
        const taken = await tx.stockBalance.updateMany({
          where: { id: current?.id ?? "", quantity: { gte: base.toString() } },
          data: { quantity: { decrement: base.toString() } },
        });
        if (taken.count !== 1) {
          throw new Error(`Balance of ${product.id} changed under its lock`);
        }
      } else if (current) {
        await tx.stockBalance.updateMany({
          where: { id: current.id },
          data: { quantity: { increment: base.toString() } },
        });
      } else {
        await tx.stockBalance.create({
          data: {
            id: newId(),
            organizationId,
            productId: product.id,
            locationId: location.id,
            quantity: base.toString(),
          },
        });
      }

      const moved = formatStock(base.toString(), unitCode);
      const left = formatStock(balance.toString(), unitCode);
      const one = base.equals(1);
      return {
        ok: true as const,
        movementId,
        // «3 cajas × 100 = 300 piezas» when it was not captured as is.
        summary:
          type === "INITIAL"
            ? `Saldo inicial de ${product.name} en ${location.name}: ${moved}${how}.`
            : type === "EXIT"
              ? `${one ? "Salió" : "Salieron"} ${moved} de ${product.name} de ${location.name}${how}. ${balance.equals(1) ? "Queda" : "Quedan"} ${left} ahí.`
              : `${one ? "Entró" : "Entraron"} ${moved} de ${product.name} a ${location.name}${how}. Ahora hay ${left} ahí.`,
      };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    // The same key arrived at once for another product (the product lock
    // did not put them in line): the database kept one movement.
    if (
      data.idempotencyKey &&
      (error as { code?: string }).code === "P2002" &&
      JSON.stringify((error as { meta?: unknown }).meta ?? "").includes(
        "idempotencyKey",
      )
    ) {
      return {
        ok: false,
        reason: "not_allowed",
        fieldErrors: {},
        formError: KEY_REUSED,
      };
    }
    throw error;
  }
}

type ReplayClient = {
  stockMovement: ReturnType<typeof forOrganization>["stockMovement"];
};

/** The movement a key already wrote in this company, with its only line. */
async function findReplay(client: ReplayClient, idempotencyKey: string) {
  return client.stockMovement.findFirst({
    where: { idempotencyKey },
    select: {
      id: true,
      type: true,
      createdByUserId: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        take: 1,
        select: {
          productId: true,
          locationId: true,
          capturedQuantity: true,
          capturedUnitCode: true,
          presentationId: true,
          baseQuantity: true,
          unitCode: true,
          product: { select: { name: true } },
          location: { select: { name: true } },
        },
      },
    },
  });
}

/**
 * Answer to a repeated confirmation: the original movement when the
 * request is the same one, a refusal when the key is being reused for
 * something else.
 */
function answerReplay(
  replay: NonNullable<Awaited<ReturnType<typeof findReplay>>>,
  type: keyof typeof KINDS,
  userId: string,
  data: z.output<typeof entrySchema>,
): MovementResult {
  const line = replay.lines[0];
  let sameQuantity = false;
  try {
    sameQuantity =
      !!line &&
      dec(data.quantity.replace(/,(?=\d{3}(\D|$))/g, "")).equals(
        line.capturedQuantity.toString(),
      );
  } catch {
    sameQuantity = false;
  }
  if (
    !line ||
    replay.type !== type ||
    replay.createdByUserId !== userId ||
    line.productId !== data.productId ||
    (data.locationId !== null && line.locationId !== data.locationId) ||
    (line.presentationId ?? null) !== data.presentationId ||
    (line.capturedUnitCode ?? null) !== data.unitCode ||
    !sameQuantity
  ) {
    return reject("not_allowed", null, KEY_REUSED);
  }
  const moved = formatStock(line.baseQuantity.toString(), line.unitCode);
  const one = dec(line.baseQuantity.toString()).equals(1);
  const what =
    type === "INITIAL"
      ? `saldo inicial de ${line.product.name} en ${line.location.name}: ${moved}`
      : type === "EXIT"
        ? `${one ? "salió" : "salieron"} ${moved} de ${line.product.name} de ${line.location.name}`
        : `${one ? "entró" : "entraron"} ${moved} de ${line.product.name} a ${line.location.name}`;
  return {
    ok: true,
    movementId: replay.id,
    repeated: true,
    summary: `Este movimiento ya estaba registrado: ${what}. No se registró de nuevo.`,
  };
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
    /**
     * How it was captured when not in the product's unit, with the content
     * the presentation had then: «3 cajas de 100», «275 centímetros».
     */
    captured: string | null;
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
          capturedQuantity: true,
          capturedUnitCode: true,
          factor: true,
          presentation: { select: { name: true } },
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
      captured: line.presentation
        ? `${formatDecimal(line.capturedQuantity.toString())} ${pluralizeName(
            line.presentation.name,
            dec(line.capturedQuantity.toString()),
          )} de ${formatDecimal(line.factor.toString())}`
        : line.capturedUnitCode
          ? formatStock(line.capturedQuantity.toString(), line.capturedUnitCode)
          : null,
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

export type PendingInitialBalance = {
  items: { id: string; sku: string; name: string; unitCode: string }[];
  /** Active products that have no movement at all. */
  total: number;
  page: number;
  pageCount: number;
};

/**
 * Active products without any movement, by name: the ones whose initial
 * balance can still be captured (INV-18). Paged by the database.
 */
export async function listProductsWithoutStock(
  actor: InventoryActor,
  options: { page?: number; pageSize?: number } = {},
): Promise<PendingInitialBalance> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.stock.read",
  );
  const pageSize = Math.min(
    Math.max(Math.trunc(options.pageSize ?? 25), 1),
    100,
  );
  const where = { status: "ACTIVE" as const, movementLines: { none: {} } };
  const client = forOrganization(actor.organizationId);
  const total = await client.product.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isSafeInteger(options.page)
    ? Number(options.page)
    : 1;
  const page = Math.min(Math.max(requested, 1), pageCount);
  const items = await client.product.findMany({
    where,
    orderBy: [{ name: "asc" }, { sku: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: { id: true, sku: true, name: true, unitCode: true },
  });
  return { items, total, page, pageCount };
}

/**
 * Whether the initial balance of a product can still be captured, and the
 * locations that already have it.
 */
export async function getInitialBalanceState(
  actor: InventoryActor,
  productId: string,
): Promise<{ open: boolean; capturedLocationIds: string[] }> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.stock.read",
  );
  const lines = await forOrganization(
    actor.organizationId,
  ).stockMovementLine.findMany({
    where: { productId: String(productId) },
    take: 500,
    select: { locationId: true, movement: { select: { type: true } } },
  });
  return {
    open: lines.every((line) => line.movement.type === "INITIAL"),
    capturedLocationIds: [...new Set(lines.map((line) => line.locationId))],
  };
}
