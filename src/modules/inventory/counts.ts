import "server-only";

import { z } from "zod";

import { dec, formatDecimal, newId, type Decimal } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import {
  pluralizeName,
  resolveConversion,
  type Capture,
} from "@/platform/catalog";
import { formatLocationPath } from "@/platform/locations";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import {
  MOVEMENT_TYPE_LABELS,
  formatStock,
  type InventoryActor,
  type MovementType,
} from "./movements";

/**
 * Physical counts: capture (INV-31). A count belongs to one location.
 * People write down what they find, product by product, in boxes, pieces
 * or another unit; every capture is turned into the product's unit and
 * added up, so «2 cajas» and «30 piezas» read as «230 piezas».
 *
 * Capturing never changes stock. The first time a product is counted the
 * count keeps its reference: that moment and the balance the system had
 * then, so later steps can tell what moved afterwards (INV-32) before
 * anything is adjusted (INV-33).
 */

export const COUNT_STATUS_LABELS = {
  OPEN: "Abierto",
  APPLIED: "Aplicado",
  CANCELLED: "Cancelado",
} as const;

export type CountStatus = keyof typeof COUNT_STATUS_LABELS;

/** Products one count can hold. */
export const COUNT_MAX_LINES = 2_000;
/** Captures of one product in one count («una caja aquí, otra allá»). */
const MAX_CAPTURES = 50;

type Failure<Field extends string> = {
  ok: false;
  reason: "invalid" | "not_found" | "not_allowed";
  field?: Field;
  error: string;
};

/** Carries an expected failure out of the transaction so it rolls back. */
class Rejected<Field extends string> extends Error {
  constructor(readonly result: Failure<Field>) {
    super("count rejected");
  }
}

const reject = <Field extends string>(
  reason: Failure<Field>["reason"],
  error: string,
  field?: Field,
): never => {
  throw new Rejected<Field>({ ok: false, reason, field, error });
};

const NOT_OPEN = "Este conteo ya está cerrado: no admite más cambios.";

const openSchema = z.object({
  locationId: z.string().trim().min(1, "Elige la ubicación que vas a contar."),
  note: z
    .string()
    .trim()
    .regex(
      /^[^\u0000-\u001f\u007f]*$/,
      "Quita los saltos de línea o tabuladores.",
    )
    .max(200, "La nota es demasiado larga (máximo 200 caracteres).")
    .optional()
    .transform((value) => (value ? value : null)),
});

export type OpenCountResult =
  | { ok: true; countId: string }
  | (Failure<"locationId" | "note"> & {
      /** The count that already holds the location. */
      openCountId?: string;
    });

/** Starts the count of a location. A location has one open count at a time. */
export async function openCount(
  actor: InventoryActor,
  input: { locationId: string; note?: string },
): Promise<OpenCountResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.count.create",
  );
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return {
      ok: false,
      reason: "invalid",
      field: issue.path[0] as "locationId" | "note",
      error: issue.message,
    };
  }
  const data = parsed.data;
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      // Archiving the location and opening its count wait for each other.
      const [locationId] = await lockRows(tx, "location", [
        data.locationId.slice(0, 36),
      ]);
      const location = locationId
        ? await tx.location.findFirst({
            where: { id: locationId },
            select: { id: true, name: true, archivedAt: true },
          })
        : null;
      if (!location) {
        return reject(
          "not_found",
          "Esa ubicación ya no existe. Elige otra.",
          "locationId",
        );
      }
      if (location.archivedAt) {
        return reject(
          "not_allowed",
          `«${location.name}» está archivada. Elige otra ubicación.`,
          "locationId",
        );
      }
      const open = await tx.stockCount.findFirst({
        where: { openLocationId: location.id },
        select: { id: true },
      });
      if (open) {
        throw new Rejected<"locationId">({
          ok: false,
          reason: "not_allowed",
          field: "locationId",
          error: `«${location.name}» ya tiene un conteo abierto. Continúalo o ciérralo antes de iniciar otro.`,
          openCountId: open.id,
        } as Failure<"locationId">);
      }
      const countId = newId();
      await tx.stockCount.create({
        data: {
          id: countId,
          organizationId,
          locationId: location.id,
          openLocationId: location.id,
          note: data.note,
          startedByUserId: userId,
        },
      });
      return { ok: true as const, countId };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result as OpenCountResult;
    throw error;
  }
}

const captureSchema = z.object({
  countId: z.string().trim().min(1).max(36),
  productId: z.string().trim().min(1, "Elige un producto.").max(36),
  /** What was found; zero is a valid answer («no hay»). */
  quantity: z.string().trim().min(1, "Escribe cuánto contaste.").max(40),
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
});

export type CaptureInput = z.input<typeof captureSchema>;

export type CaptureResult =
  | {
      ok: true;
      captureId: string;
      /** «Tornillo: 2 cajas × 100 = 200 piezas. Van 230 piezas contadas.» */
      summary: string;
      /** Everything counted of the product so far, in its unit: "230". */
      counted: string;
      /** Boxes and loose units were both captured: worth a second look. */
      mixed: boolean;
    }
  | Failure<"productId" | "quantity">;

/**
 * Writes down what was found of a product. Several captures of the same
 * product add up. Stock does not change.
 */
export async function captureCount(
  actor: InventoryActor,
  input: CaptureInput,
): Promise<CaptureResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.count.update",
  );
  const parsed = captureSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = issue.path[0];
    return {
      ok: false,
      reason: "invalid",
      field: field === "productId" ? "productId" : "quantity",
      error: issue.message,
    };
  }
  const data = parsed.data;
  if (data.presentationId && data.unitCode) {
    return {
      ok: false,
      reason: "invalid",
      field: "quantity",
      error: "Elige una sola forma de capturar: presentación o unidad.",
    };
  }
  const isZero = /^0+([.,]0+)?$/.test(data.quantity);

  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      // The product first — the same order every movement uses — so the
      // balance read as reference cannot change while it is written down.
      const [productId] = await lockRows(tx, "product", [data.productId]);
      // Then the count: captures, closing and applying go one at a time.
      const [countId] = await lockRows(tx, "stockCount", [data.countId]);
      const count = countId
        ? await tx.stockCount.findFirst({
            where: { id: countId },
            select: { id: true, status: true, locationId: true },
          })
        : null;
      if (!count) return reject("not_found", "Este conteo ya no existe.");
      if (count.status !== "OPEN") return reject("not_allowed", NOT_OPEN);

      const product = productId
        ? await tx.product.findFirst({
            where: { id: productId },
            select: { id: true, name: true, status: true, unitCode: true },
          })
        : null;
      if (!product) {
        return reject("not_found", "Este producto ya no existe.", "productId");
      }
      if (product.status !== "ACTIVE") {
        return reject(
          "not_allowed",
          `${product.name} está archivado: reactívalo para contarlo.`,
          "productId",
        );
      }

      // Zero needs no conversion; anything else follows the product's rule
      // and the content the presentation has now (INV-09).
      let captured = {
        capturedQuantity: "0",
        capturedUnitCode: null as string | null,
        presentationId: null as string | null,
        presentationVersionId: null as string | null,
        factor: "1",
        base: dec(0),
        preview: formatStock("0", product.unitCode),
      };
      if (!isZero) {
        const capture: Capture = data.presentationId
          ? {
              kind: "presentation",
              quantity: data.quantity,
              presentationId: data.presentationId,
            }
          : data.unitCode
            ? { kind: "unit", quantity: data.quantity, unitCode: data.unitCode }
            : { kind: "base", quantity: data.quantity };
        const resolved = await resolveConversion(tx, product.id, capture);
        if (!resolved.ok) return reject("invalid", resolved.error, "quantity");
        const c = resolved.conversion;
        captured = {
          capturedQuantity: c.capturedQuantity.toString(),
          capturedUnitCode: c.capturedUnitCode,
          presentationId: c.presentation?.id ?? null,
          presentationVersionId: c.presentation?.versionId ?? null,
          factor: c.factor.toString(),
          base: c.baseQuantity,
          preview:
            c.presentation || c.capturedUnitCode
              ? c.preview
              : formatStock(c.baseQuantity.toString(), product.unitCode),
        };
      }

      let line = await tx.stockCountLine.findFirst({
        where: { countId: count.id, productId: product.id },
        select: {
          id: true,
          captures: {
            take: MAX_CAPTURES + 1,
            select: {
              baseQuantity: true,
              presentationId: true,
              capturedUnitCode: true,
            },
          },
        },
      });
      if (!line) {
        const lines = await tx.stockCountLine.count({
          where: { countId: count.id },
        });
        if (lines >= COUNT_MAX_LINES) {
          return reject(
            "not_allowed",
            `Un conteo admite hasta ${COUNT_MAX_LINES.toLocaleString("es-MX")} productos. Ciérralo y sigue en otro.`,
          );
        }
        // Reference of the comparison: now, and what the system has now.
        const balance = await tx.stockBalance.findFirst({
          where: { productId: product.id, locationId: count.locationId },
          select: { quantity: true },
        });
        const id = newId();
        await tx.stockCountLine.create({
          data: {
            id,
            organizationId,
            countId: count.id,
            productId: product.id,
            countedAt: new Date(),
            systemQuantity: balance?.quantity.toString() ?? "0",
            unitCode: product.unitCode,
          },
        });
        line = { id, captures: [] };
      }
      if (line.captures.length >= MAX_CAPTURES) {
        return reject(
          "not_allowed",
          `${product.name} ya tiene ${MAX_CAPTURES} capturas en este conteo. Quita algunas y escribe el total.`,
          "quantity",
        );
      }

      const captureId = newId();
      await tx.stockCountCapture.create({
        data: {
          id: captureId,
          organizationId,
          lineId: line.id,
          productId: product.id,
          capturedQuantity: captured.capturedQuantity,
          capturedUnitCode: captured.capturedUnitCode,
          presentationId: captured.presentationId,
          presentationVersionId: captured.presentationVersionId,
          factor: captured.factor,
          baseQuantity: captured.base.toString(),
          createdByUserId: userId,
        },
      });

      const counted = line.captures.reduce(
        (sum, capture) => sum.plus(capture.baseQuantity.toString()),
        captured.base,
      );
      const all = [
        ...line.captures,
        {
          presentationId: captured.presentationId,
          capturedUnitCode: captured.capturedUnitCode,
        },
      ];
      const countedLabel = formatStock(counted.toString(), product.unitCode);
      return {
        ok: true as const,
        captureId,
        counted: counted.toString(),
        mixed: isMixed(all),
        summary:
          all.length === 1
            ? `${product.name}: ${captured.preview}.`
            : `${product.name}: ${captured.preview}. Van ${countedLabel} contadas en ${all.length} capturas.`,
      };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result as CaptureResult;
    throw error;
  }
}

/** Packages and loose units of the same product, both written down. */
function isMixed(captures: { presentationId: string | null }[]): boolean {
  return (
    captures.some((capture) => capture.presentationId) &&
    captures.some((capture) => !capture.presentationId)
  );
}

export type CountChangeResult = { ok: true } | Failure<never>;

/** Takes back one capture; a product left without captures is not counted. */
export async function removeCapture(
  actor: InventoryActor,
  input: { countId: string; captureId: string },
): Promise<CountChangeResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.count.update",
  );
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      const [countId] = await lockRows(tx, "stockCount", [
        String(input.countId).slice(0, 36),
      ]);
      const count = countId
        ? await tx.stockCount.findFirst({
            where: { id: countId },
            select: { id: true, status: true },
          })
        : null;
      if (!count) return reject("not_found", "Este conteo ya no existe.");
      if (count.status !== "OPEN") return reject("not_allowed", NOT_OPEN);
      const capture = await tx.stockCountCapture.findFirst({
        where: {
          id: String(input.captureId).slice(0, 36),
          line: { countId: count.id },
        },
        select: { id: true, lineId: true },
      });
      if (!capture) return reject("not_found", "Esa captura ya no existe.");
      await tx.stockCountCapture.deleteMany({ where: { id: capture.id } });
      const left = await tx.stockCountCapture.count({
        where: { lineId: capture.lineId },
      });
      if (left === 0) {
        // Counted again later, the product gets a new reference.
        await tx.stockCountLine.deleteMany({ where: { id: capture.lineId } });
      }
      return { ok: true as const };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result as CountChangeResult;
    throw error;
  }
}

/** Abandons an open count. Nothing it captured touches stock. */
export async function cancelCount(
  actor: InventoryActor,
  countId: string,
): Promise<CountChangeResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.count.update",
  );
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      const [id] = await lockRows(tx, "stockCount", [
        String(countId).slice(0, 36),
      ]);
      const count = id
        ? await tx.stockCount.findFirst({
            where: { id },
            select: { id: true, status: true },
          })
        : null;
      if (!count) return reject("not_found", "Este conteo ya no existe.");
      if (count.status !== "OPEN") return reject("not_allowed", NOT_OPEN);
      await tx.stockCount.updateMany({
        where: { id: count.id },
        data: {
          status: "CANCELLED",
          openLocationId: null,
          closedAt: new Date(),
          closedByUserId: userId,
        },
      });
      return { ok: true as const };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result as CountChangeResult;
    throw error;
  }
}

const locationSelect = {
  name: true,
  parent: { select: { name: true, parent: { select: { name: true } } } },
} as const;

type LocationNames = {
  name: string;
  parent: { name: string; parent: { name: string } | null } | null;
};

const pathOf = (location: LocationNames) =>
  formatLocationPath(
    [
      location.parent?.parent?.name,
      location.parent?.name,
      location.name,
    ].filter((name): name is string => Boolean(name)),
  );

/** Names of people of this company, by account. */
async function namesOf(
  organizationId: string,
  userIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const members = await forOrganization(organizationId).membership.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, user: { select: { name: true } } },
  });
  return new Map(members.map((member) => [member.userId, member.user.name]));
}

export type CountSummary = {
  id: string;
  /** «Zona A › Estante 3». */
  location: string;
  status: CountStatus;
  statusLabel: string;
  note: string | null;
  startedAt: Date;
  startedByName: string | null;
  closedAt: Date | null;
  /** Products counted so far. */
  products: number;
};

/** Counts of the company: the open ones first, then the latest. */
export async function listCounts(
  actor: InventoryActor,
  options: { limit?: number } = {},
): Promise<CountSummary[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.count.read",
  );
  const counts = await forOrganization(
    actor.organizationId,
  ).stockCount.findMany({
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(options.limit ?? 30, 1), 100),
    select: {
      id: true,
      status: true,
      note: true,
      startedAt: true,
      startedByUserId: true,
      closedAt: true,
      location: { select: locationSelect },
      _count: { select: { lines: true } },
    },
  });
  const names = await namesOf(
    actor.organizationId,
    counts.map((count) => count.startedByUserId),
  );
  return counts
    .map((count) => ({
      id: count.id,
      location: pathOf(count.location),
      status: count.status,
      statusLabel: COUNT_STATUS_LABELS[count.status],
      note: count.note,
      startedAt: count.startedAt,
      startedByName: names.get(count.startedByUserId) ?? null,
      closedAt: count.closedAt,
      products: count._count.lines,
    }))
    .sort(
      (a, b) =>
        Number(b.status === "OPEN") - Number(a.status === "OPEN") ||
        b.startedAt.getTime() - a.startedAt.getTime(),
    );
}

export type CountLine = {
  lineId: string;
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  /** Moment the product was first counted: the reference (INV-32). */
  countedAt: Date;
  captures: {
    id: string;
    /** «2 cajas × 100 = 200 piezas», «275 centímetros = 2.75 metros», «30 piezas». */
    label: string;
  }[];
  /** Sum of its captures, in the product's unit: "230". */
  counted: string;
  /** «230 piezas». */
  countedLabel: string;
  /** What the system had when it was first counted. */
  system: string;
  systemLabel: string;
  /** counted − system: "-20", "0", "15". */
  difference: string;
  /** «Faltan 20 piezas», «Sobran 15 piezas», «Coincide». */
  differenceLabel: string;
  /** Packages and loose units both captured: check nothing was counted twice. */
  mixed: boolean;
  /**
   * What happened in the location after the product was counted (INV-32).
   * Only while the count is open; null once it is closed.
   */
  since: {
    /** Balance of the location right now. */
    current: string;
    currentLabel: string;
    /** current − system: what moved after counting. "0" = nothing. */
    moved: string;
    /** «Después de contarlo salieron 5 piezas», or null when nothing moved. */
    movedLabel: string | null;
    /** The movements behind it, newest first (the latest few). */
    movements: {
      movementId: string;
      typeLabel: string;
      createdAt: Date;
      /** «−5 piezas», «+12 piezas». */
      quantity: string;
    }[];
    /** How many there are in all, shown or not. */
    movementCount: number;
    /**
     * What the location should hold once the difference is applied:
     * current + difference. The count stays right about what it saw, and
     * what moved later is kept.
     */
    target: string;
    targetLabel: string;
    /**
     * More left afterwards than the count found: applying would leave
     * less than nothing. The product has to be counted again.
     */
    conflict: boolean;
  } | null;
};

export type CountDetail = CountSummary & {
  locationId: string;
  closedByName: string | null;
  /** Adjustment written when it was applied with differences (INV-33). */
  appliedMovementId: string | null;
  lines: CountLine[];
  /** Lines whose count differs from the system. */
  differences: number;
  /** Lines of an open count whose product moved after being counted. */
  movedAfter: number;
  /** Lines that cannot be applied until they are counted again. */
  conflicts: number;
};

/** A count with everything captured, the latest product first. */
export async function getCount(
  actor: InventoryActor,
  countId: string,
): Promise<CountDetail | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.count.read",
  );
  const count = await forOrganization(
    actor.organizationId,
  ).stockCount.findFirst({
    where: { id: String(countId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      note: true,
      locationId: true,
      startedAt: true,
      startedByUserId: true,
      closedAt: true,
      closedByUserId: true,
      appliedMovementId: true,
      location: { select: locationSelect },
      lines: {
        orderBy: [{ countedAt: "desc" }, { id: "desc" }],
        take: COUNT_MAX_LINES,
        select: {
          id: true,
          productId: true,
          countedAt: true,
          systemQuantity: true,
          unitCode: true,
          product: { select: { name: true, sku: true } },
          captures: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: MAX_CAPTURES,
            select: {
              id: true,
              capturedQuantity: true,
              capturedUnitCode: true,
              presentationId: true,
              factor: true,
              baseQuantity: true,
              presentation: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!count) return null;
  const names = await namesOf(actor.organizationId, [
    count.startedByUserId,
    count.closedByUserId,
  ]);

  // While the count is open, what moved after each product was counted
  // (INV-32). The balance only changes with movements and the reference
  // was read under the product's lock, so «what moved since» is exactly
  // today's balance minus the reference: no clock is trusted for it. The
  // movements themselves are listed to explain the number.
  const open = count.status === "OPEN";
  const client = forOrganization(actor.organizationId);
  const productIds = count.lines.map((line) => line.productId);
  const balances = new Map<string, string>();
  const later = new Map<
    string,
    {
      movementId: string;
      type: MovementType;
      createdAt: Date;
      signed: Decimal;
    }[]
  >();
  if (open && productIds.length > 0) {
    const firstCountedAt = new Date(
      Math.min(...count.lines.map((line) => line.countedAt.getTime())),
    );
    const countedAt = new Map(
      count.lines.map((line) => [line.productId, line.countedAt]),
    );
    for (let start = 0; start < productIds.length; start += 500) {
      const ids = productIds.slice(start, start + 500);
      const [held, moved] = await Promise.all([
        client.stockBalance.findMany({
          where: { locationId: count.locationId, productId: { in: ids } },
          select: { productId: true, quantity: true },
        }),
        client.stockMovementLine.findMany({
          where: {
            locationId: count.locationId,
            productId: { in: ids },
            createdAt: { gte: firstCountedAt },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 2_000,
          select: {
            productId: true,
            direction: true,
            baseQuantity: true,
            createdAt: true,
            movement: { select: { id: true, type: true } },
          },
        }),
      ]);
      for (const balance of held) {
        balances.set(balance.productId, balance.quantity.toString());
      }
      for (const line of moved) {
        // Each product has its own reference moment.
        if (line.createdAt <= countedAt.get(line.productId)!) continue;
        const quantity = dec(line.baseQuantity.toString());
        const list = later.get(line.productId) ?? [];
        list.push({
          movementId: line.movement.id,
          type: line.movement.type,
          createdAt: line.createdAt,
          signed: line.direction === "IN" ? quantity : quantity.negated(),
        });
        later.set(line.productId, list);
      }
    }
  }

  const lines: CountLine[] = count.lines.map((line) => {
    const { unitCode } = line;
    const counted = line.captures.reduce(
      (sum, capture) => sum.plus(capture.baseQuantity.toString()),
      dec(0),
    );
    const system = dec(line.systemQuantity.toString());
    const difference = counted.minus(system);
    return {
      lineId: line.id,
      productId: line.productId,
      name: line.product.name,
      sku: line.product.sku,
      unitCode,
      countedAt: line.countedAt,
      captures: line.captures.map((capture) => {
        const quantity = dec(capture.capturedQuantity.toString());
        const base = formatStock(capture.baseQuantity.toString(), unitCode);
        return {
          id: capture.id,
          label: capture.presentation
            ? `${formatDecimal(quantity)} ${pluralizeName(capture.presentation.name, quantity)} × ${formatDecimal(capture.factor.toString())} = ${base}`
            : capture.capturedUnitCode
              ? `${formatStock(quantity.toString(), capture.capturedUnitCode)} = ${base}`
              : base,
        };
      }),
      counted: counted.toString(),
      countedLabel: formatStock(counted.toString(), unitCode),
      system: system.toString(),
      systemLabel: formatStock(system.toString(), unitCode),
      difference: difference.toString(),
      differenceLabel: difference.isZero()
        ? "Coincide"
        : difference.isNegative()
          ? `${difference.abs().equals(1) ? "Falta" : "Faltan"} ${formatStock(difference.abs().toString(), unitCode)}`
          : `${difference.equals(1) ? "Sobra" : "Sobran"} ${formatStock(difference.toString(), unitCode)}`,
      mixed: isMixed(line.captures),
      since: open
        ? sinceCounted(
            unitCode,
            system,
            difference,
            dec(balances.get(line.productId) ?? 0),
            later.get(line.productId) ?? [],
          )
        : null,
    };
  });

  return {
    id: count.id,
    location: pathOf(count.location),
    locationId: count.locationId,
    status: count.status,
    statusLabel: COUNT_STATUS_LABELS[count.status],
    note: count.note,
    startedAt: count.startedAt,
    startedByName: names.get(count.startedByUserId) ?? null,
    closedAt: count.closedAt,
    closedByName: count.closedByUserId
      ? (names.get(count.closedByUserId) ?? null)
      : null,
    appliedMovementId: count.appliedMovementId,
    products: lines.length,
    lines,
    differences: lines.filter((line) => line.difference !== "0").length,
    movedAfter: lines.filter((line) => line.since && line.since.moved !== "0")
      .length,
    conflicts: lines.filter((line) => line.since?.conflict).length,
  };
}

/** Movements shown under a counted product; the rest are only counted. */
const LATER_SHOWN = 5;

function sinceCounted(
  unitCode: string,
  system: Decimal,
  difference: Decimal,
  current: Decimal,
  movements: {
    movementId: string;
    type: MovementType;
    createdAt: Date;
    signed: Decimal;
  }[],
): NonNullable<CountLine["since"]> {
  const moved = current.minus(system);
  const target = current.plus(difference);
  const amount = formatStock(moved.abs().toString(), unitCode);
  const one = moved.abs().equals(1);
  return {
    current: current.toString(),
    currentLabel: formatStock(current.toString(), unitCode),
    moved: moved.toString(),
    movedLabel: moved.isZero()
      ? // In and out by the same amount: nothing changed, but it moved.
        movements.length > 0
        ? "Después de contarlo hubo movimientos que se compensan entre sí"
        : null
      : moved.isNegative()
        ? `Después de contarlo ${one ? "salió" : "salieron"} ${amount}`
        : `Después de contarlo ${one ? "entró" : "entraron"} ${amount}`,
    movements: movements.slice(0, LATER_SHOWN).map((movement) => ({
      movementId: movement.movementId,
      typeLabel: MOVEMENT_TYPE_LABELS[movement.type],
      createdAt: movement.createdAt,
      quantity: `${movement.signed.isNegative() ? "−" : "+"}${formatStock(movement.signed.abs().toString(), unitCode)}`,
    })),
    movementCount: movements.length,
    target: target.toString(),
    targetLabel: formatStock(
      (target.isNegative() ? dec(0) : target).toString(),
      unitCode,
    ),
    conflict: target.isNegative(),
  };
}

/** A balance beyond this is a mistake, not stock. */
const MAX_BALANCE = "999999999999.999";

const applySchema = z.object({
  countId: z.string().trim().min(1).max(36),
  /** Why stock is being corrected: always required (FUN-07). */
  reason: z
    .string()
    .trim()
    .regex(
      /^[^\u0000-\u001f\u007f]*$/,
      "Quita los saltos de línea o tabuladores.",
    )
    .min(
      5,
      "Escribe el motivo, por ejemplo: conteo de cierre de mes o revisión por faltante.",
    )
    .max(500, "El motivo es demasiado largo (máximo 500 caracteres)."),
});

export type ApplyCountResult =
  | {
      ok: true;
      /** Null when nothing differed: the count closed without adjusting. */
      movementId: string | null;
      /** Products whose stock was corrected. */
      adjusted: number;
      /** «Conteo aplicado: se ajustaron 3 productos.» */
      summary: string;
      /** It had already been applied: nothing was written now. */
      repeated?: true;
    }
  | (Failure<"reason"> & {
      /** Products that must be counted again before applying. */
      conflicts?: string[];
    });

/**
 * Applies a count (INV-33): every difference becomes a line of one
 * adjustment, with the reason, and the count is closed for good.
 *
 * Applying twice never adjusts twice: the count is locked and read again
 * inside the transaction — an applied one only answers what it did — and
 * the adjustment carries a key derived from the count, which the database
 * keeps unique and no form can send.
 *
 * What moved after each product was counted is respected (INV-32): the
 * line adds or takes the difference found then; it does not force today's
 * balance to what was counted.
 */
export async function applyCount(
  actor: InventoryActor,
  input: { countId: string; reason: string },
): Promise<ApplyCountResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "inventory.count.apply");
  // Applying writes adjustments: it takes that permission too (matrix).
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.adjustment.create",
  );
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return {
      ok: false,
      reason: "invalid",
      field: issue.path[0] === "reason" ? "reason" : undefined,
      error: issue.message,
    };
  }
  const data = parsed.data;
  const client = forOrganization(organizationId);

  // Products are locked before the count (the order every movement and
  // capture uses), so they have to be known first. If a capture adds a
  // product in between, the check inside notices and this starts over.
  for (let attempt = 0; attempt < 3; attempt++) {
    const known = await client.stockCountLine.findMany({
      where: { countId: data.countId },
      take: COUNT_MAX_LINES,
      select: { productId: true },
    });
    try {
      const result = await client.$transaction(
        async (tx) => {
          const locked = new Set(
            await lockRows(
              tx,
              "product",
              known.map((line) => line.productId),
            ),
          );
          const [countId] = await lockRows(tx, "stockCount", [data.countId]);
          const count = countId
            ? await tx.stockCount.findFirst({
                where: { id: countId },
                select: {
                  id: true,
                  status: true,
                  locationId: true,
                  appliedMovementId: true,
                  location: { select: { name: true } },
                  lines: {
                    take: COUNT_MAX_LINES,
                    orderBy: [{ countedAt: "asc" }, { id: "asc" }],
                    select: {
                      productId: true,
                      systemQuantity: true,
                      unitCode: true,
                      product: { select: { name: true } },
                      captures: {
                        take: MAX_CAPTURES,
                        select: { baseQuantity: true },
                      },
                    },
                  },
                },
              })
            : null;
          if (!count) return reject("not_found", "Este conteo ya no existe.");
          if (count.status === "APPLIED") {
            const adjusted = count.appliedMovementId
              ? await tx.stockMovementLine.count({
                  where: { movementId: count.appliedMovementId },
                })
              : 0;
            return {
              ok: true as const,
              movementId: count.appliedMovementId,
              adjusted,
              repeated: true as const,
              summary: "Este conteo ya estaba aplicado. No se ajustó de nuevo.",
            };
          }
          if (count.status !== "OPEN") return reject("not_allowed", NOT_OPEN);
          if (count.lines.length === 0) {
            return reject(
              "not_allowed",
              "Este conteo no tiene productos contados: no hay nada que aplicar.",
            );
          }
          if (count.lines.some((line) => !locked.has(line.productId))) {
            // Someone captured another product meanwhile: start over.
            return "retry" as const;
          }

          const balances = new Map(
            (
              await tx.stockBalance.findMany({
                where: {
                  locationId: count.locationId,
                  productId: { in: [...locked] },
                },
                select: { id: true, productId: true, quantity: true },
              })
            ).map((balance) => [balance.productId, balance]),
          );
          const conflicts: string[] = [];
          const adjustments: {
            productId: string;
            unitCode: string;
            direction: "IN" | "OUT";
            amount: string;
            balanceId: string | null;
          }[] = [];
          for (const line of count.lines) {
            const counted = line.captures.reduce(
              (sum, capture) => sum.plus(capture.baseQuantity.toString()),
              dec(0),
            );
            const difference = counted.minus(line.systemQuantity.toString());
            if (difference.isZero()) continue;
            const balance = balances.get(line.productId);
            const target = dec(balance?.quantity.toString() ?? 0).plus(
              difference,
            );
            if (target.isNegative() || target.greaterThan(MAX_BALANCE)) {
              conflicts.push(line.product.name);
              continue;
            }
            adjustments.push({
              productId: line.productId,
              unitCode: line.unitCode,
              direction: difference.isPositive() ? "IN" : "OUT",
              amount: difference.abs().toString(),
              balanceId: balance?.id ?? null,
            });
          }
          if (conflicts.length > 0) {
            throw new Rejected<"reason">({
              ok: false,
              reason: "not_allowed",
              error:
                conflicts.length === 1
                  ? `${conflicts[0]} se movió después de contarlo y su diferencia ya no cabe. Vuelve a contarlo antes de aplicar.`
                  : `${conflicts.length} productos se movieron después de contarlos y su diferencia ya no cabe. Vuelve a contarlos antes de aplicar.`,
              conflicts,
            } as Failure<"reason">);
          }

          let movementId: string | null = null;
          if (adjustments.length > 0) {
            movementId = newId();
            await tx.stockMovement.create({
              data: {
                id: movementId,
                organizationId,
                type: "ADJUSTMENT",
                reason: data.reason,
                reference: `Conteo de ${count.location.name}`.slice(0, 120),
                // One adjustment per count, also for the database. The
                // colon keeps it apart from the keys forms send (letters,
                // digits, "-" and "_"): nobody can take it beforehand.
                idempotencyKey: `count:${count.id}`,
                createdByUserId: userId,
              },
            });
            await tx.stockMovementLine.createMany({
              data: adjustments.map((adjustment, index) => ({
                id: newId(),
                organizationId,
                movementId: movementId!,
                lineNumber: index + 1,
                productId: adjustment.productId,
                locationId: count.locationId,
                direction: adjustment.direction,
                // The difference, in the product's unit: that is what moves.
                capturedQuantity: adjustment.amount,
                factor: "1",
                baseQuantity: adjustment.amount,
                unitCode: adjustment.unitCode,
              })),
            });
            for (const adjustment of adjustments) {
              if (adjustment.direction === "OUT") {
                const changed = await tx.stockBalance.updateMany({
                  where: {
                    id: adjustment.balanceId ?? "",
                    quantity: { gte: adjustment.amount },
                  },
                  data: { quantity: { decrement: adjustment.amount } },
                });
                if (changed.count !== 1) {
                  throw new Error(
                    `Balance of ${adjustment.productId} changed under its lock`,
                  );
                }
              } else if (adjustment.balanceId) {
                await tx.stockBalance.updateMany({
                  where: { id: adjustment.balanceId },
                  data: { quantity: { increment: adjustment.amount } },
                });
              } else {
                await tx.stockBalance.create({
                  data: {
                    id: newId(),
                    organizationId,
                    productId: adjustment.productId,
                    locationId: count.locationId,
                    quantity: adjustment.amount,
                  },
                });
              }
            }
          }

          await tx.stockCount.updateMany({
            where: { id: count.id },
            data: {
              status: "APPLIED",
              openLocationId: null,
              closedAt: new Date(),
              closedByUserId: userId,
              appliedMovementId: movementId,
            },
          });
          await recordAuditEvent(tx, {
            organizationId,
            actorUserId: userId,
            action: "inventory.count_applied",
            target: { type: "stock_count", id: count.id },
            reason: data.reason,
            metadata: {
              ubicacion: count.location.name,
              productosContados: count.lines.length,
              productosAjustados: adjustments.length,
              movementId,
            },
          });

          const n = adjustments.length;
          return {
            ok: true as const,
            movementId,
            adjusted: n,
            summary:
              n === 0
                ? "Conteo aplicado: todo coincidía, no hubo nada que ajustar."
                : n === 1
                  ? "Conteo aplicado: se ajustó 1 producto."
                  : `Conteo aplicado: se ajustaron ${n.toLocaleString("es-MX")} productos.`,
          };
        },
        // A long count writes many lines: give it room.
        { ...LOCKING_TRANSACTION, timeout: 60_000, maxWait: 15_000 },
      );
      if (result !== "retry") return result;
    } catch (error) {
      if (error instanceof Rejected) return error.result as ApplyCountResult;
      throw error;
    }
  }
  return {
    ok: false,
    reason: "not_allowed",
    error:
      "El conteo sigue recibiendo capturas. Espera a que terminen e inténtalo de nuevo.",
  };
}
