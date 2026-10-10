import "server-only";

import { z } from "zod";

import { dec, formatDecimal, isAppError, newId } from "@/lib";
import { formatStock } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import {
  getUnit,
  pluralizeName,
  resolveConversion,
  type Capture,
} from "@/platform/catalog";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import type { PurchasingActor } from "./product-suppliers";

/**
 * Purchase orders: the draft and its lines (CMP-04). An order is what the
 * company asks a supplier for. It is born as a draft, numbered within the
 * company, and only while it is a draft can its lines be added, changed
 * or removed.
 *
 * A line keeps, like a stock movement, what was asked for as written, the
 * presentation with the version of its content at that moment, and the
 * result in the product's unit — «3 cajas × 100 = 300 piezas». The
 * browser sends only what was typed and the id of the presentation; the
 * content is read here, inside the transaction.
 *
 * Costs are private to Compras: a line's cost is written only by who may
 * record costs and read only by who may see them. For anyone else the
 * columns are not even fetched.
 */

export const PURCHASE_ORDER_STATUS_LABELS = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  PARTIAL: "Recibida en parte",
  RECEIVED: "Recibida",
  CANCELLED: "Cancelada",
} as const;

export type PurchaseOrderStatus = keyof typeof PURCHASE_ORDER_STATUS_LABELS;

/** «OC-0007»: how an order is named to people. */
export const formatOrderNumber = (number: number) =>
  `OC-${String(number).padStart(4, "0")}`;

/** Lines an order holds at most. */
export const PURCHASE_ORDER_MAX_LINES = 200;

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day as 2026-10-15, or null when the text is not one. */
function parseDay(text: string): Date | null {
  if (!DAY.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === text &&
    date.getUTCFullYear() >= 2000
    ? date
    : null;
}

const headerSchema = z.object({
  expectedOn: z
    .string()
    .trim()
    .optional()
    .transform((value, context) => {
      if (!value) return null;
      const day = parseDay(value);
      if (!day) {
        context.addIssue({
          code: "custom",
          message: "Elige un día del calendario, o déjalo vacío.",
        });
        return z.NEVER;
      }
      return day;
    }),
  notes: z
    .string()
    .trim()
    .max(500, "Las notas admiten hasta 500 caracteres.")
    .optional()
    .transform((value) => (value ? value : null)),
});

export type OrderHeaderInput = z.input<typeof headerSchema>;
export type OrderField =
  | "supplierId"
  | "expectedOn"
  | "notes"
  | "productId"
  | "capture"
  | "quantity"
  | "unitCost";

export type OrderFailure = {
  ok: false;
  reason: "invalid" | "not_found" | "not_draft";
  fieldErrors: Partial<Record<OrderField, string>>;
  formError?: string;
};

const refuse = (
  reason: OrderFailure["reason"],
  field: OrderField | null,
  message: string,
): OrderFailure => ({
  ok: false,
  reason,
  fieldErrors: field ? { [field]: message } : {},
  ...(field ? {} : { formError: message }),
});

/** Carries an expected refusal out of a transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: OrderFailure) {
    super("order rejected");
  }
}

const NOT_FOUND = "Esta orden ya no existe.";
const NOT_DRAFT =
  "Esta orden ya no es un borrador: sus líneas y sus datos ya no se cambian.";

function headerErrors(error: z.ZodError): OrderFailure {
  const fieldErrors: Partial<Record<OrderField, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as OrderField;
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, reason: "invalid", fieldErrors };
}

export type CreateOrderResult =
  { ok: true; orderId: string; number: number } | OrderFailure;

/**
 * Starts an order for a supplier of the company, as a draft without
 * lines. Its number is the next one of the company.
 */
export async function createPurchaseOrder(
  actor: PurchasingActor,
  input: OrderHeaderInput & { supplierId: string },
): Promise<CreateOrderResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.order.create",
  );
  const parsed = headerSchema.safeParse(input);
  if (!parsed.success) return headerErrors(parsed.error);
  const client = forOrganization(organizationId);
  const supplier = await client.contact.findFirst({
    where: {
      id: String(input.supplierId ?? "").slice(0, 36),
      isSupplier: true,
    },
    select: { id: true, name: true, archivedAt: true },
  });
  if (!supplier) {
    return refuse("not_found", "supplierId", "Elige un proveedor de la lista.");
  }
  if (supplier.archivedAt) {
    return refuse(
      "invalid",
      "supplierId",
      `${supplier.name} está archivado: no se le hacen órdenes.`,
    );
  }
  const orderId = newId();
  // The number is the next free one. Two orders started at the same
  // moment would ask for the same: the unique index keeps one and the
  // other simply asks again.
  for (let attempt = 0; attempt < 6; attempt++) {
    const last = await client.purchaseOrder.findFirst({
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const number = (last?.number ?? 0) + 1;
    try {
      await client.$transaction(async (tx) => {
        await tx.purchaseOrder.create({
          data: {
            id: orderId,
            organizationId,
            number,
            contactId: supplier.id,
            expectedOn: parsed.data.expectedOn,
            notes: parsed.data.notes,
            createdByUserId: userId,
          },
        });
        await recordAuditEvent(tx, {
          organizationId,
          actorUserId: userId,
          action: "purchase_order.created",
          target: { type: "purchase_order", id: orderId },
          metadata: {
            orden: formatOrderNumber(number),
            proveedor: supplier.name,
          },
        });
      });
      return { ok: true, orderId, number };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new Error("Could not number the purchase order");
}

/**
 * The order, locked for the rest of the transaction and still a draft.
 * Everything that changes an order starts here, so two changes of the
 * same order happen one after the other and none lands on an order that
 * is no longer a draft.
 */
async function lockDraft(tx: Tx, orderId: string) {
  const [id] = await lockRows(tx, "purchaseOrder", [
    String(orderId).slice(0, 36),
  ]);
  const order = id
    ? await tx.purchaseOrder.findFirst({
        where: { id },
        select: { id: true, status: true, contactId: true },
      })
    : null;
  if (!order) throw new Rejected(refuse("not_found", null, NOT_FOUND));
  if (order.status !== "DRAFT") {
    throw new Rejected(refuse("not_draft", null, NOT_DRAFT));
  }
  return order;
}

async function inDraft<T>(
  organizationId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T | OrderFailure> {
  try {
    return await forOrganization(organizationId).$transaction(
      work,
      LOCKING_TRANSACTION,
    );
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

/** Changes the expected day and the notes of a draft. */
export async function updatePurchaseOrder(
  actor: PurchasingActor,
  orderId: string,
  input: OrderHeaderInput,
): Promise<{ ok: true } | OrderFailure> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.order.update",
  );
  const parsed = headerSchema.safeParse(input);
  if (!parsed.success) return headerErrors(parsed.error);
  return inDraft(organizationId, async (tx) => {
    const order = await lockDraft(tx, orderId);
    await tx.purchaseOrder.updateMany({
      where: { id: order.id },
      data: { expectedOn: parsed.data.expectedOn, notes: parsed.data.notes },
    });
    return { ok: true as const };
  });
}

export type OrderLineInput = {
  /** `base` or `p:<id of a presentation of the product>`. */
  capture: string;
  /** As typed: "3", "2.75". */
  quantity: string;
  /**
   * Cost of one captured unit, as typed. Undefined leaves the cost as it
   * is; an empty text clears it; anything else needs the permission to
   * record costs.
   */
  unitCost?: string;
};

const MAX_COST = "9999999999.9999";

/** A cost as typed («250.50», «1,250»), exact; null when it is not one. */
function parseCost(text: string): string | null {
  const value = text
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d{1,10}(\.\d{1,4})?$/.test(value)) return null;
  const cost = dec(value);
  return cost.greaterThan(MAX_COST) ? null : cost.toString();
}

function captureOf(text: string, quantity: string): Capture | null {
  if (text === "base" || text === "") return { kind: "base", quantity };
  const match = /^p:([0-9a-f-]{36})$/i.exec(text);
  return match
    ? { kind: "presentation", quantity, presentationId: match[1]! }
    : null;
}

/**
 * What a line is, read and converted inside the transaction: the factor
 * and the version come from the catalog as it is now, never from the
 * browser.
 */
async function resolveLine(tx: Tx, productId: string, input: OrderLineInput) {
  const capture = captureOf(
    String(input.capture ?? "").trim(),
    String(input.quantity ?? ""),
  );
  if (!capture) {
    throw new Rejected(
      refuse("invalid", "capture", "Elige cómo lo pides, de la lista."),
    );
  }
  const resolved = await resolveConversion(tx, productId, capture);
  if (!resolved.ok) {
    throw new Rejected(
      refuse(
        "invalid",
        // A presentation that is not of the product is a problem of the
        // choice; anything else (half a box, a letter) is of the number.
        capture.kind === "presentation" &&
          /no existe para este producto/.test(resolved.error)
          ? "capture"
          : "quantity",
        resolved.error,
      ),
    );
  }
  const { conversion, product } = resolved;
  return {
    capturedQuantity: conversion.capturedQuantity.toString(),
    presentationId: conversion.presentation?.id ?? null,
    presentationVersionId: conversion.presentation?.versionId ?? null,
    factor: conversion.factor.toString(),
    baseQuantity: conversion.baseQuantity.toString(),
    unitCode: product.unitCode,
  };
}

/** The cost a line is being given, checked; `undefined` = not touched. */
async function costOf(
  actor: PurchasingActor,
  input: OrderLineInput,
): Promise<{ ok: true; cost: string | null | undefined } | OrderFailure> {
  if (input.unitCost === undefined) return { ok: true, cost: undefined };
  // Writing a cost, or erasing one, is for who may record costs.
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.cost.record",
  );
  const text = String(input.unitCost).trim();
  if (text === "") return { ok: true, cost: null };
  const cost = parseCost(text);
  return cost === null
    ? refuse(
        "invalid",
        "unitCost",
        "Escribe el costo como 250.50, con hasta 4 decimales, o déjalo vacío.",
      )
    : { ok: true, cost };
}

/** Adds a product to a draft. */
export async function addOrderLine(
  actor: PurchasingActor,
  orderId: string,
  input: OrderLineInput & { productId: string },
): Promise<{ ok: true; lineId: string } | OrderFailure> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.order.update",
  );
  const cost = await costOf(actor, input);
  if (!cost.ok) return cost;
  const productId = String(input.productId ?? "").slice(0, 36);
  if (productId === "") {
    return refuse("invalid", "productId", "Elige el producto.");
  }
  return inDraft(organizationId, async (tx) => {
    const order = await lockDraft(tx, orderId);
    const product = await tx.product.findFirst({
      where: { id: productId },
      select: { id: true, sku: true, status: true },
    });
    if (!product) {
      throw new Rejected(
        refuse("not_found", "productId", "Ese producto ya no existe."),
      );
    }
    if (product.status !== "ACTIVE") {
      throw new Rejected(
        refuse(
          "invalid",
          "productId",
          `${product.sku} está archivado. Reactívalo para pedirlo.`,
        ),
      );
    }
    const last = await tx.purchaseOrderLine.findFirst({
      where: { orderId: order.id },
      orderBy: { lineNumber: "desc" },
      select: { lineNumber: true },
    });
    const count = await tx.purchaseOrderLine.count({
      where: { orderId: order.id },
    });
    if (count >= PURCHASE_ORDER_MAX_LINES) {
      throw new Rejected(
        refuse(
          "invalid",
          null,
          `Una orden admite hasta ${PURCHASE_ORDER_MAX_LINES} líneas. Haz otra orden para lo que falta.`,
        ),
      );
    }
    const line = await resolveLine(tx, product.id, input);
    // The code this supplier knows it by, as it is today.
    const link = await tx.productSupplier.findFirst({
      where: { productId: product.id, contactId: order.contactId },
      select: { supplierSku: true },
    });
    const lineId = newId();
    await tx.purchaseOrderLine.create({
      data: {
        id: lineId,
        organizationId,
        orderId: order.id,
        lineNumber: (last?.lineNumber ?? 0) + 1,
        productId: product.id,
        supplierSku: link?.supplierSku ?? null,
        ...line,
        unitCost: cost.cost ?? null,
      },
    });
    return { ok: true as const, lineId };
  });
}

/** The draft a line belongs to, locked; the line as it is. */
async function lockLine(tx: Tx, lineId: string) {
  // The order is not known before reading the line; it is locked right
  // after and the line read again under that lock.
  const found = await tx.purchaseOrderLine.findFirst({
    where: { id: String(lineId).slice(0, 36) },
    select: { id: true, orderId: true },
  });
  if (!found) {
    throw new Rejected(
      refuse("not_found", null, "Esa línea ya no está en la orden."),
    );
  }
  await lockDraft(tx, found.orderId);
  const line = await tx.purchaseOrderLine.findFirst({
    where: { id: found.id },
    select: { id: true, productId: true },
  });
  if (!line) {
    throw new Rejected(
      refuse("not_found", null, "Esa línea ya no está en la orden."),
    );
  }
  return line;
}

/** Changes how much of a product a draft asks for, and its cost. */
export async function updateOrderLine(
  actor: PurchasingActor,
  lineId: string,
  input: OrderLineInput,
): Promise<{ ok: true } | OrderFailure> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.order.update",
  );
  const cost = await costOf(actor, input);
  if (!cost.ok) return cost;
  return inDraft(organizationId, async (tx) => {
    const line = await lockLine(tx, lineId);
    const resolved = await resolveLine(tx, line.productId, input);
    await tx.purchaseOrderLine.updateMany({
      where: { id: line.id },
      data: {
        ...resolved,
        ...(cost.cost === undefined ? {} : { unitCost: cost.cost }),
      },
    });
    return { ok: true as const };
  });
}

/** Takes a product out of a draft. */
export async function removeOrderLine(
  actor: PurchasingActor,
  lineId: string,
): Promise<{ ok: true } | OrderFailure> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.order.update",
  );
  return inDraft(organizationId, async (tx) => {
    const line = await lockLine(tx, lineId);
    await tx.purchaseOrderLine.deleteMany({ where: { id: line.id } });
    return { ok: true as const };
  });
}

/** Whether the person may see costs: never an error, just yes or no. */
async function mayReadCosts(actor: PurchasingActor): Promise<boolean> {
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "purchasing.cost.read",
    );
    return true;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return false;
    throw error;
  }
}

const money = (amount: ReturnType<typeof dec>) =>
  `$${formatDecimal(amount, { minScale: 2 })}`;

export type PurchaseOrderLine = {
  id: string;
  lineNumber: number;
  productId: string;
  sku: string;
  productName: string;
  supplierSku: string | null;
  /** `base` or `p:<id>`: what the edit form shows as chosen. */
  capture: string;
  /** As it was written: "3". */
  capturedQuantity: string;
  /** «3 cajas × 100 = 300 piezas», or «25 piezas» when asked by unit. */
  quantityText: string;
  /** «caja», «pieza»: one unit of what was captured. */
  perText: string;
  /**
   * Cost of one captured unit and of the line. Absent — not null — for
   * who may not see costs.
   */
  unitCost?: string | null;
  unitCostText?: string | null;
  amountText?: string | null;
};

export type PurchaseOrderDetail = {
  id: string;
  number: number;
  numberText: string;
  status: PurchaseOrderStatus;
  statusLabel: string;
  /** Its lines and data can still be changed. */
  editable: boolean;
  supplierId: string;
  supplierName: string;
  /** 2026-10-15, or null. */
  expectedOn: string | null;
  notes: string | null;
  createdAt: Date;
  lines: PurchaseOrderLine[];
  costsVisible: boolean;
  /** Sum of the lines with a cost; absent for who may not see costs. */
  totalText?: string | null;
  /** Lines without a cost yet: the total does not include them. */
  linesWithoutCost?: number;
};

const lineSelect = {
  id: true,
  lineNumber: true,
  productId: true,
  supplierSku: true,
  capturedQuantity: true,
  presentationId: true,
  factor: true,
  baseQuantity: true,
  unitCode: true,
  product: { select: { sku: true, name: true } },
  presentation: { select: { name: true } },
} as const;

type LineRow = {
  id: string;
  lineNumber: number;
  productId: string;
  supplierSku: string | null;
  capturedQuantity: { toString(): string };
  presentationId: string | null;
  factor: { toString(): string };
  baseQuantity: { toString(): string };
  unitCode: string;
  product: { sku: string; name: string };
  presentation: { name: string } | null;
  unitCost?: { toString(): string } | null;
};

function toLine(row: LineRow, withCosts: boolean): PurchaseOrderLine {
  const captured = dec(row.capturedQuantity.toString());
  const base = formatStock(row.baseQuantity.toString(), row.unitCode);
  const line: PurchaseOrderLine = {
    id: row.id,
    lineNumber: row.lineNumber,
    productId: row.productId,
    sku: row.product.sku,
    productName: row.product.name,
    supplierSku: row.supplierSku,
    capture: row.presentationId ? `p:${row.presentationId}` : "base",
    capturedQuantity: captured.toString(),
    quantityText: row.presentation
      ? `${formatDecimal(captured)} ${pluralizeName(row.presentation.name, captured).toLowerCase()} × ${formatDecimal(row.factor.toString())} = ${base}`
      : base,
    perText: row.presentation
      ? row.presentation.name.toLowerCase()
      : getUnit(row.unitCode).name,
  };
  if (!withCosts) return line;
  if (row.unitCost === null || row.unitCost === undefined) {
    return { ...line, unitCost: null, unitCostText: null, amountText: null };
  }
  const cost = dec(row.unitCost.toString());
  return {
    ...line,
    unitCost: cost.toString(),
    unitCostText: `${money(cost)} por ${line.perText}`,
    amountText: money(captured.times(cost)),
  };
}

/** An order of the company with its lines; null when it is not one of its orders. */
export async function getPurchaseOrder(
  actor: PurchasingActor,
  orderId: string,
): Promise<PurchaseOrderDetail | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.order.read",
  );
  const costsVisible = await mayReadCosts(actor);
  const row = await forOrganization(
    actor.organizationId,
  ).purchaseOrder.findFirst({
    where: { id: String(orderId).slice(0, 36) },
    select: {
      id: true,
      number: true,
      status: true,
      expectedOn: true,
      notes: true,
      createdAt: true,
      contact: { select: { id: true, name: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        take: PURCHASE_ORDER_MAX_LINES,
        // The cost column is asked for only for who may see it.
        select: costsVisible ? { ...lineSelect, unitCost: true } : lineSelect,
      },
    },
  });
  if (!row) return null;
  const rows: LineRow[] = row.lines;
  const detail: PurchaseOrderDetail = {
    id: row.id,
    number: row.number,
    numberText: formatOrderNumber(row.number),
    status: row.status,
    statusLabel: PURCHASE_ORDER_STATUS_LABELS[row.status],
    editable: row.status === "DRAFT",
    supplierId: row.contact.id,
    supplierName: row.contact.name,
    expectedOn: row.expectedOn
      ? row.expectedOn.toISOString().slice(0, 10)
      : null,
    notes: row.notes,
    createdAt: row.createdAt,
    lines: rows.map((line) => toLine(line, costsVisible)),
    costsVisible,
  };
  if (!costsVisible) return detail;
  const costed = rows.filter(
    (line) => line.unitCost !== null && line.unitCost !== undefined,
  );
  const total = costed.reduce(
    (sum, line) =>
      sum.plus(
        dec(line.capturedQuantity.toString()).times(
          dec(line.unitCost!.toString()),
        ),
      ),
    dec(0),
  );
  return {
    ...detail,
    totalText: costed.length > 0 ? money(total) : null,
    linesWithoutCost: rows.length - costed.length,
  };
}

export type PurchaseOrderSummary = {
  id: string;
  numberText: string;
  status: PurchaseOrderStatus;
  statusLabel: string;
  supplierName: string;
  lines: number;
  expectedOn: string | null;
  createdAt: Date;
};

export const PURCHASE_ORDER_PAGE_SIZE = 25;

export type PurchaseOrderPage = {
  items: PurchaseOrderSummary[];
  total: number;
  page: number;
  pageCount: number;
  /** The state the list was narrowed to, when it was. */
  status: PurchaseOrderStatus | null;
};

export const isPurchaseOrderStatus = (
  value: unknown,
): value is PurchaseOrderStatus =>
  typeof value === "string" &&
  Object.hasOwn(PURCHASE_ORDER_STATUS_LABELS, value);

/**
 * Orders of the company, newest first, a page at a time; optionally only
 * those in one state. No amounts here: the list is the same for everyone
 * who may see orders.
 */
export async function listPurchaseOrders(
  actor: PurchasingActor,
  options: { page?: number; status?: unknown } = {},
): Promise<PurchaseOrderPage> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.order.read",
  );
  // An unknown state is ignored, not an error.
  const status = isPurchaseOrderStatus(options.status) ? options.status : null;
  const where = status ? { status } : {};
  const client = forOrganization(actor.organizationId);
  const total = await client.purchaseOrder.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PURCHASE_ORDER_PAGE_SIZE));
  const page =
    options.page === undefined || !Number.isSafeInteger(options.page)
      ? 1
      : Math.min(Math.max(options.page, 1), pageCount);
  const rows = await client.purchaseOrder.findMany({
    where,
    // The number is unique in the company: a stable order on its index.
    orderBy: { number: "desc" },
    skip: (page - 1) * PURCHASE_ORDER_PAGE_SIZE,
    take: PURCHASE_ORDER_PAGE_SIZE,
    select: {
      id: true,
      number: true,
      status: true,
      expectedOn: true,
      createdAt: true,
      contact: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      numberText: formatOrderNumber(row.number),
      status: row.status,
      statusLabel: PURCHASE_ORDER_STATUS_LABELS[row.status],
      supplierName: row.contact.name,
      lines: row._count.lines,
      expectedOn: row.expectedOn
        ? row.expectedOn.toISOString().slice(0, 10)
        : null,
      createdAt: row.createdAt,
    })),
    total,
    page,
    pageCount,
    status,
  };
}
