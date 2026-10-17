import "server-only";

import { z } from "zod";

import { dec, formatDecimal, isAppError, newId } from "@/lib";
import { formatStock, postReceiptEntry } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import {
  getUnit,
  parseQuantity,
  pluralizeName,
  type Capture,
} from "@/platform/catalog";
import { formatLocationPath } from "@/platform/locations";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import {
  PURCHASE_ORDER_MAX_LINES,
  advanceOrderOnReceipt,
  formatOrderNumber,
} from "./orders";
import {
  PURCHASE_ORDER_STATUS_LABELS,
  transitionProblem,
  type PurchaseOrderStatus,
} from "./order-states";
import { recordLastCost, type PurchasingActor } from "./product-suppliers";

/**
 * Receipts of purchase orders (CMP-07). Receiving writes, in one
 * transaction, the receipt with its lines, the entry of stock (a `RECEIPT`
 * movement, written by Inventario) and the new state of the order: the
 * goods are in stock and the order says so, or nothing happened.
 *
 * What is pending of a line is counted in the terms it was ordered in
 * (3 boxes ordered, 1 received → 2 boxes pending); what enters stock is
 * converted with the content of the presentation in force when it arrives.
 *
 * Order of locks, as every movement: products → location → order.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Decimal = ReturnType<typeof dec>;

/** Random text chosen by whoever shows the form: a UUID fits. */
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

const KEY_REUSED =
  "Esta confirmación ya se usó para otra recepción. Recarga la página para registrar una nueva.";

const receiveSchema = z.object({
  /** Empty = the default location, «General». */
  locationId: z
    .string()
    .trim()
    .max(36)
    .optional()
    .transform((value) => value || null),
  reference: z
    .string()
    .trim()
    .regex(
      /^[^\u0000-\u001f\u007f]*$/,
      "Quita los saltos de línea o tabuladores.",
    )
    .max(80, "La remisión admite hasta 80 caracteres.")
    .optional()
    .transform((value) => value || null),
  idempotencyKey: z
    .string()
    .regex(KEY, "Recarga la página para registrar la recepción."),
  /**
   * What arrived of each line, in the terms it was ordered in (CMP-08).
   * Absent = everything pending; a line left out or empty did not arrive.
   */
  lines: z
    .array(
      z.object({
        orderLineId: z.string().trim().max(36),
        quantity: z.string().trim().max(40),
        /** Somewhere else than the rest of the receipt (CMP-09). */
        locationId: z.string().trim().max(36).optional(),
      }),
    )
    .max(PURCHASE_ORDER_MAX_LINES)
    .optional(),
});

export type ReceiveInput = z.input<typeof receiveSchema>;
export type ReceiveField = "locationId" | "reference";

export type ReceiveResult =
  | {
      ok: true;
      receiptId: string;
      status: PurchaseOrderStatus;
      /** «Recibiste 3 productos de OC-0007 en General…». */
      summary: string;
      /** It had already been registered (a retry): nothing was written now. */
      repeated?: true;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_allowed" | "invalid_transition";
      fieldErrors: Partial<Record<ReceiveField, string>>;
      formError?: string;
      /** Problem of each line, by the id of the order line. */
      lineErrors?: Record<string, string>;
    };

type Failure = Extract<ReceiveResult, { ok: false }>;

/** Carries an expected refusal out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("receipt rejected");
  }
}

const refuse = (
  reason: Failure["reason"],
  field: ReceiveField | null,
  message: string,
): never => {
  throw new Rejected({
    ok: false,
    reason,
    fieldErrors: field ? { [field]: message } : {},
    ...(field ? {} : { formError: message }),
  });
};

const refuseLines = (
  lineErrors: Record<string, string>,
  formError?: string,
): never => {
  throw new Rejected({
    ok: false,
    reason: "invalid",
    fieldErrors: {},
    formError:
      formError ??
      (Object.keys(lineErrors).length === 1
        ? "Revisa la cantidad marcada."
        : "Revisa las cantidades marcadas."),
    lineErrors,
  });
};

/** What has arrived of each line of an order, in the terms it was ordered in. */
export async function receivedByLine(
  client: Pick<Tx, "purchaseReceiptLine">,
  orderLineIds: string[],
): Promise<Map<string, Decimal>> {
  if (orderLineIds.length === 0) return new Map();
  const rows = await client.purchaseReceiptLine.groupBy({
    by: ["orderLineId"],
    where: { orderLineId: { in: orderLineIds } },
    _sum: { capturedQuantity: true },
  });
  return new Map(
    rows.map((row) => [
      row.orderLineId,
      dec(row._sum.capturedQuantity?.toString() ?? 0),
    ]),
  );
}

/**
 * Receives everything still pending of an order (CMP-07) in one location:
 * the receipt, the entry of stock and the order marked as received, in
 * one transaction. Repeating the confirmation (a double click, a retry
 * after a lost answer) receives once.
 */
export async function receivePurchaseOrder(
  actor: PurchasingActor,
  orderId: string,
  input: ReceiveInput,
): Promise<ReceiveResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.receipt.create",
  );
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ReceiveField, string>> = {};
    let formError: string | undefined;
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "locationId" || field === "reference") {
        fieldErrors[field] ??= issue.message;
      } else {
        formError ??= issue.message;
      }
    }
    return { ok: false, reason: "invalid", fieldErrors, formError };
  }
  const data = parsed.data;
  const client = forOrganization(organizationId);
  // Asked before the transaction: it reads the permissions with its own
  // connection (MOD-08).
  const recordCosts = await mayRecordCosts(actor);

  // The lines of an order that is no longer a draft never change
  // (triggers), so reading them before locking is safe; they tell which
  // products to lock.
  const order = await client.purchaseOrder.findFirst({
    where: { id: String(orderId).slice(0, 36) },
    select: {
      id: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        take: PURCHASE_ORDER_MAX_LINES,
        select: { productId: true },
      },
    },
  });
  if (!order) {
    return {
      ok: false,
      reason: "not_found",
      fieldErrors: {},
      formError: "Esta orden ya no existe.",
    };
  }

  try {
    return await client.$transaction(async (tx) => {
      await lockRows(
        tx,
        "product",
        order.lines.map((line) => line.productId),
      );
      if (data.locationId) await lockRows(tx, "location", [data.locationId]);
      await lockRows(tx, "purchaseOrder", [order.id]);

      // A retry answers with the receipt it already wrote, before any other
      // check: by now the order is received because of that very receipt.
      const replay = await tx.purchaseReceipt.findFirst({
        where: { idempotencyKey: data.idempotencyKey },
        select: {
          id: true,
          orderId: true,
          receivedByUserId: true,
          order: { select: { status: true, number: true } },
          lines: {
            select: {
              orderLineId: true,
              capturedQuantity: true,
              locationId: true,
            },
          },
        },
      });
      if (replay) {
        if (
          replay.orderId !== order.id ||
          replay.receivedByUserId !== userId ||
          !sameReceipt(replay.lines, data)
        ) {
          return refuse("not_allowed", null, KEY_REUSED);
        }
        return {
          ok: true as const,
          receiptId: replay.id,
          status: replay.order.status,
          repeated: true as const,
          summary: `Esta recepción de ${formatOrderNumber(replay.order.number)} ya estaba registrada. No se registró de nuevo.`,
        };
      }

      const current = await tx.purchaseOrder.findFirst({
        where: { id: order.id },
        select: {
          id: true,
          number: true,
          status: true,
          contactId: true,
          contact: { select: { name: true } },
          lines: {
            orderBy: { lineNumber: "asc" },
            take: PURCHASE_ORDER_MAX_LINES,
            select: {
              id: true,
              productId: true,
              capturedQuantity: true,
              presentationId: true,
              unitCode: true,
              unitCost: true,
              product: { select: { quantityStep: true } },
              presentation: { select: { name: true } },
            },
          },
        },
      });
      if (!current)
        return refuse("not_found", null, "Esta orden ya no existe.");
      if (current.status !== "SENT" && current.status !== "PARTIAL") {
        return refuse(
          "invalid_transition",
          null,
          transitionProblem(current.status, "RECEIVED") ??
            "Esta orden no está esperando mercancía.",
        );
      }

      const received = await receivedByLine(
        tx,
        current.lines.map((line) => line.id),
      );
      const left = new Map(
        current.lines.map((line) => [
          line.id,
          dec(line.capturedQuantity.toString()).minus(
            received.get(line.id) ?? 0,
          ),
        ]),
      );
      if (![...left.values()].some((quantity) => quantity.greaterThan(0))) {
        return refuse(
          "invalid",
          null,
          "Ya se recibió todo lo que pide esta orden.",
        );
      }
      const pending = data.lines
        ? chosenLines(current.lines, left, data.lines)
        : current.lines
            .map((line) => ({
              line,
              quantity: left.get(line.id)!,
              locationId: null as string | null,
            }))
            .filter((entry) => entry.quantity.greaterThan(0));

      const numberText = formatOrderNumber(current.number);
      const entry = await postReceiptEntry(
        tx,
        { organizationId, userId },
        {
          locationId: data.locationId,
          lines: pending.map(({ line, quantity, locationId }) => ({
            productId: line.productId,
            locationId,
            capture: (line.presentationId
              ? {
                  kind: "presentation",
                  quantity: quantity.toString(),
                  presentationId: line.presentationId,
                }
              : { kind: "base", quantity: quantity.toString() }) as Capture,
          })),
          reference: data.reference
            ? `${numberText} · ${data.reference}`
            : numberText,
          reason:
            `Recepción de la orden ${numberText} de ${current.contact.name}`.slice(
              0,
              500,
            ),
        },
      );
      if (!entry.ok) {
        if (entry.line !== null && pending[entry.line]) {
          return refuseLines(
            { [pending[entry.line]!.line.id]: entry.error },
            entry.error,
          );
        }
        return refuse("invalid", "locationId", entry.error);
      }

      const receiptId = newId();
      await tx.purchaseReceipt.create({
        data: {
          id: receiptId,
          organizationId,
          orderId: current.id,
          movementId: entry.movementId,
          reference: data.reference,
          idempotencyKey: data.idempotencyKey,
          receivedByUserId: userId,
        },
      });
      await tx.purchaseReceiptLine.createMany({
        data: entry.lines.map((line, index) => ({
          id: newId(),
          organizationId,
          receiptId,
          lineNumber: line.lineNumber,
          orderLineId: pending[index]!.line.id,
          productId: line.productId,
          locationId: line.locationId,
          capturedQuantity: line.capturedQuantity.toString(),
          presentationId: line.presentationId,
          presentationVersionId: line.presentationVersionId,
          factor: line.factor.toString(),
          baseQuantity: line.baseQuantity.toString(),
          unitCode: line.unitCode,
          unitCost: pending[index]!.line.unitCost?.toString() ?? null,
        })),
      });
      // CMP-13: the cost of what arrived becomes the last cost of the
      // product at this supplier (no valuation: just the last price).
      if (recordCosts) {
        await recordReceivedCosts(tx, {
          organizationId,
          userId,
          supplierId: current.contactId,
          lines: entry.lines.map((line, index) => ({
            productId: line.productId,
            presentationId: line.presentationId,
            presentationVersionId: line.presentationVersionId,
            unitCost: pending[index]!.line.unitCost,
          })),
        });
      }

      // Received when nothing is left of any line; in part otherwise.
      for (const { line, quantity } of pending) {
        left.set(line.id, left.get(line.id)!.minus(quantity));
      }
      const missing = [...left.values()].filter((quantity) =>
        quantity.greaterThan(0),
      ).length;
      const status: PurchaseOrderStatus =
        missing === 0 ? "RECEIVED" : "PARTIAL";
      await advanceOrderOnReceipt(tx, current.id, status);
      // «General», or «General y A-01» when lines went to several places.
      const places = [...new Set(entry.lines.map((line) => line.locationName))];
      const where =
        places.length === 1
          ? places[0]!
          : `${places.slice(0, -1).join(", ")} y ${places.at(-1)}`;
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "purchase_order.received",
        target: { type: "purchase_order", id: current.id },
        metadata: {
          orden: numberText,
          proveedor: current.contact.name,
          productos: entry.lines.length,
          ubicacion: places.join(", "),
          ...(data.reference ? { remision: data.reference } : {}),
          estado: PURCHASE_ORDER_STATUS_LABELS[status],
        },
      });
      const count = entry.lines.length;
      return {
        ok: true as const,
        receiptId,
        status,
        summary: `Recibiste ${count === 1 ? "1 producto" : `${count} productos`} de ${numberText} en ${where}. ${
          missing === 0
            ? "La orden quedó recibida."
            : `La orden quedó recibida en parte: ${missing === 1 ? "falta 1 producto" : `faltan ${missing} productos`}.`
        }`,
      };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    // The same key arrived at once for another order (the order locks did
    // not put them in line): the database kept one receipt.
    if (
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

/**
 * Whether a repeated confirmation asks for what its key already received
 * (CMP-10): the same lines, quantities and, when chosen, locations. A key
 * sent again with other quantities is not a retry but a reused form.
 * Without lines («everything pending») there is nothing to compare.
 */
function sameReceipt(
  stored: {
    orderLineId: string;
    capturedQuantity: { toString(): string };
    locationId: string;
  }[],
  data: z.output<typeof receiveSchema>,
): boolean {
  if (!data.lines) return true;
  const asked = data.lines.filter(
    (item) =>
      item.quantity.trim() !== "" &&
      !/^0+([.,]0*)?$/.test(item.quantity.trim()),
  );
  if (asked.length !== stored.length) return false;
  const byLine = new Map(stored.map((line) => [line.orderLineId, line]));
  return asked.every((item) => {
    const line = byLine.get(item.orderLineId);
    if (!line) return false;
    let same = false;
    try {
      same = dec(item.quantity.replace(/,(?=\d{3}(\D|$))/g, "")).equals(
        line.capturedQuantity.toString(),
      );
    } catch {
      return false;
    }
    const where = item.locationId || data.locationId;
    return same && (!where || where === line.locationId);
  });
}

type OrderLineRow = {
  id: string;
  productId: string;
  presentationId: string | null;
  unitCode: string;
  unitCost: { toString(): string } | null;
  product: { quantityStep: { toString(): string } };
  presentation: { name: string } | null;
};

/**
 * The lines the person said arrived, with their quantities checked: each
 * one a line of this order, once, a valid quantity for how it was ordered
 * (whole boxes; the product's step) and never more than what is pending
 * (NEG-24). Empty or zero = it did not arrive this time.
 */
function chosenLines(
  lines: OrderLineRow[],
  left: Map<string, Decimal>,
  requested: { orderLineId: string; quantity: string; locationId?: string }[],
): { line: OrderLineRow; quantity: Decimal; locationId?: string | null }[] {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const errors: Record<string, string> = {};
  const chosen: {
    line: OrderLineRow;
    quantity: Decimal;
    locationId?: string | null;
  }[] = [];
  const seen = new Set<string>();
  for (const item of requested) {
    const line = byId.get(item.orderLineId);
    if (!line || seen.has(line.id)) {
      return refuse(
        "invalid",
        null,
        "Lo que mandaste no corresponde a esta orden. Recarga la página.",
      );
    }
    seen.add(line.id);
    const text = item.quantity.trim();
    if (text === "" || /^0+([.,]0*)?$/.test(text)) continue;
    const parsed = parseQuantity(
      line.presentationId
        ? { unitCode: "piece", quantityStep: "1" }
        : {
            unitCode: line.unitCode,
            quantityStep: line.product.quantityStep.toString(),
          },
      text,
    );
    if (!parsed.ok) {
      errors[line.id] =
        line.presentationId && /completas/.test(parsed.error)
          ? `Escribe ${line.presentation ? pluralizeName(line.presentation.name, dec(2)) : "presentaciones"} completas.`
          : parsed.error;
      continue;
    }
    const pending = left.get(line.id)!;
    if (pending.lessThanOrEqualTo(0)) {
      errors[line.id] = "Este producto ya llegó completo.";
      continue;
    }
    if (parsed.quantity.greaterThan(pending)) {
      errors[line.id] =
        `Solo faltan ${inTermsOf(pending, line.presentation, line.unitCode)}. Lo que llegó de más no se recibe en esta orden.`;
      continue;
    }
    chosen.push({
      line,
      quantity: parsed.quantity,
      locationId: item.locationId || null,
    });
  }
  if (Object.keys(errors).length > 0) return refuseLines(errors);
  if (chosen.length === 0) {
    return refuse(
      "invalid",
      null,
      "Escribe cuánto llegó de al menos un producto.",
    );
  }
  return chosen;
}

/**
 * Whether a confirmation reached the server although its answer was lost
 * (INV-22): the receipt that key wrote for this person, if any.
 */
export async function findReceiptConfirmation(
  actor: PurchasingActor,
  idempotencyKey: string,
): Promise<{ receiptId: string; orderId: string } | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.receipt.read",
  );
  const key = String(idempotencyKey ?? "").trim();
  if (!KEY.test(key)) return null;
  const receipt = await forOrganization(
    actor.organizationId,
  ).purchaseReceipt.findFirst({
    where: { idempotencyKey: key, receivedByUserId: actor.userId },
    select: { id: true, orderId: true },
  });
  return receipt ? { receiptId: receipt.id, orderId: receipt.orderId } : null;
}

export type PendingLine = {
  orderLineId: string;
  lineNumber: number;
  productName: string;
  sku: string;
  /** «3 cajas» or «25 piezas»: as it was ordered. */
  orderedText: string;
  /** Null while nothing of it arrived. */
  receivedText: string | null;
  /** Null when it all arrived. */
  pendingText: string | null;
  /** What is pending as a plain number for a form ("2"), or "0". */
  pendingQuantity: string;
  /** «cajas», «piezas»: what the quantity counts. */
  unitText: string;
  /** «1 caja = 120 piezas»: what will enter for each one; null by unit. */
  contentText: string | null;
  /** «1 caja = 100 piezas» when the content changed since it was ordered. */
  orderedContentText: string | null;
};

export type ReceiptSummary = {
  id: string;
  createdAt: Date;
  authorName: string | null;
  reference: string | null;
  lines: {
    receiptLineId: string;
    productName: string;
    sku: string;
    /** «3 cajas × 100 = 300 piezas» with the content it was received with. */
    quantityText: string;
    locationPath: string;
    /** Where it was put: where a return takes it from by default. */
    locationId: string;
    /** What may still go back to the supplier ("2"), or "0" (CMP-12). */
    returnableQuantity: string;
    /** «2 cajas»; null when everything already went back. */
    returnableText: string | null;
    /** «1 caja» already returned; null while nothing was. */
    returnedText: string | null;
    /** «cajas», «piezas». */
    unitText: string;
  }[];
  /** Absent for who may not see returns (`purchasing.return.read`). */
  returns?: {
    id: string;
    createdAt: Date;
    authorName: string | null;
    reason: string;
    lines: {
      productName: string;
      sku: string;
      /** «1 caja × 100 = 100 piezas». */
      quantityText: string;
      locationPath: string;
    }[];
  }[];
};

export type OrderReceipts = {
  /** Something of it is still pending and the order is waiting for it. */
  canReceive: boolean;
  /** Something received may still go back to the supplier (CMP-12). */
  canReturn: boolean;
  lines: PendingLine[];
  /** Newest first. */
  receipts: ReceiptSummary[];
};

const placeSelect = {
  name: true,
  parent: { select: { name: true, parent: { select: { name: true } } } },
} as const;

/** «Zona A › Pasillo 2 › A-01». */
function pathOf(location: {
  name: string;
  parent: { name: string; parent: { name: string } | null } | null;
}): string {
  return formatLocationPath(
    [
      location.parent?.parent?.name,
      location.parent?.name,
      location.name,
    ].filter((name): name is string => Boolean(name)),
  );
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

/**
 * The last cost of each received product at the supplier of the order
 * (CMP-13), from the cost of its order line, for the presentation version
 * it arrived with. A product bought from a supplier it was not linked to
 * gets the link: buying it there is what the link says. Inside the
 * transaction of the receipt, with the products already locked.
 */
async function recordReceivedCosts(
  tx: Tx,
  input: {
    organizationId: string;
    userId: string;
    supplierId: string;
    lines: {
      productId: string;
      presentationId: string | null;
      presentationVersionId: string | null;
      unitCost: { toString(): string } | null;
    }[];
  },
): Promise<void> {
  const at = new Date();
  for (const line of input.lines) {
    if (line.unitCost === null) continue;
    const linked = await tx.productSupplier.findFirst({
      where: { productId: line.productId, contactId: input.supplierId },
      select: { id: true },
    });
    if (!linked) {
      await tx.productSupplier.create({
        data: {
          id: newId(),
          organizationId: input.organizationId,
          productId: line.productId,
          contactId: input.supplierId,
          presentationId: line.presentationId,
          createdByUserId: input.userId,
        },
      });
    }
    await recordLastCost(tx, {
      productId: line.productId,
      supplierId: input.supplierId,
      cost: line.unitCost.toString(),
      presentationVersion:
        line.presentationId && line.presentationVersionId
          ? {
              presentationId: line.presentationId,
              versionId: line.presentationVersionId,
            }
          : null,
      at,
    });
  }
}

/** Whether the person may see returns: never an error, just yes or no. */
async function mayReadReturns(actor: PurchasingActor): Promise<boolean> {
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "purchasing.return.read",
    );
    return true;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return false;
    throw error;
  }
}

/** «3 cajas», «2.5 metros»: a quantity in the terms of an order line. */
export function inTermsOf(
  quantity: Decimal,
  presentation: { name: string } | null,
  unitCode: string,
): string {
  return presentation
    ? `${formatDecimal(quantity)} ${pluralizeName(presentation.name, quantity).toLowerCase()}`
    : formatStock(quantity.toString(), unitCode);
}

/**
 * What arrived of an order and what is still pending, with its receipts
 * (CMP-07). Null when it is not an order of the company.
 */
export async function getOrderReceipts(
  actor: PurchasingActor,
  orderId: string,
): Promise<OrderReceipts | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.receipt.read",
  );
  const client = forOrganization(actor.organizationId);
  const order = await client.purchaseOrder.findFirst({
    where: { id: String(orderId).slice(0, 36) },
    select: {
      id: true,
      status: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        take: PURCHASE_ORDER_MAX_LINES,
        select: {
          id: true,
          lineNumber: true,
          capturedQuantity: true,
          unitCode: true,
          factor: true,
          product: { select: { name: true, sku: true } },
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
      },
      receipts: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: {
          id: true,
          createdAt: true,
          reference: true,
          receivedByUserId: true,
          lines: {
            orderBy: { lineNumber: "asc" },
            select: {
              id: true,
              capturedQuantity: true,
              factor: true,
              baseQuantity: true,
              unitCode: true,
              locationId: true,
              product: { select: { name: true, sku: true } },
              presentation: { select: { name: true } },
              location: { select: placeSelect },
              returnLines: { select: { capturedQuantity: true } },
            },
          },
          returns: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 50,
            select: {
              id: true,
              createdAt: true,
              reason: true,
              returnedByUserId: true,
              lines: {
                orderBy: { lineNumber: "asc" },
                select: {
                  capturedQuantity: true,
                  factor: true,
                  unitCode: true,
                  product: { select: { name: true, sku: true } },
                  receiptLine: {
                    select: { presentation: { select: { name: true } } },
                  },
                  location: { select: placeSelect },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const received = await receivedByLine(
    client,
    order.lines.map((line) => line.id),
  );
  const lines = order.lines.map((line): PendingLine => {
    const ordered = dec(line.capturedQuantity.toString());
    const got = received.get(line.id) ?? dec(0);
    const left = ordered.minus(got);
    // CMP-09: what one presentation holds today, which is what will enter,
    // and what it held when it was ordered when that changed.
    const today = line.presentation?.versions[0]?.factor.toString();
    const one = (factor: string) =>
      `1 ${line.presentation!.name.toLowerCase()} = ${formatStock(factor, line.unitCode)}`;
    const content =
      line.presentation && today
        ? {
            contentText: one(today),
            orderedContentText: dec(today).equals(line.factor.toString())
              ? null
              : one(line.factor.toString()),
          }
        : { contentText: null, orderedContentText: null };
    return {
      ...content,
      orderLineId: line.id,
      lineNumber: line.lineNumber,
      productName: line.product.name,
      sku: line.product.sku,
      orderedText: inTermsOf(ordered, line.presentation, line.unitCode),
      receivedText: got.greaterThan(0)
        ? inTermsOf(got, line.presentation, line.unitCode)
        : null,
      pendingText: left.greaterThan(0)
        ? inTermsOf(left, line.presentation, line.unitCode)
        : null,
      pendingQuantity: left.greaterThan(0) ? left.toFixed() : "0",
      unitText: line.presentation
        ? pluralizeName(line.presentation.name, dec(2)).toLowerCase()
        : getUnit(line.unitCode).plural,
    };
  });

  const seeReturns = await mayReadReturns(actor);
  const authors = await client.membership.findMany({
    where: {
      userId: {
        in: [
          ...new Set([
            ...order.receipts.map((r) => r.receivedByUserId),
            ...order.receipts.flatMap((r) =>
              r.returns.map((back) => back.returnedByUserId),
            ),
          ]),
        ],
      },
    },
    select: { userId: true, user: { select: { name: true } } },
  });
  const names = new Map(authors.map((row) => [row.userId, row.user.name]));

  const receipts = order.receipts.map((receipt): ReceiptSummary => ({
    id: receipt.id,
    createdAt: receipt.createdAt,
    authorName: names.get(receipt.receivedByUserId) ?? null,
    reference: receipt.reference,
    lines: receipt.lines.map((line) => {
      const captured = dec(line.capturedQuantity.toString());
      const base = formatStock(line.baseQuantity.toString(), line.unitCode);
      const back = line.returnLines.reduce(
        (sum, row) => sum.plus(row.capturedQuantity.toString()),
        dec(0),
      );
      const left = captured.minus(back);
      return {
        receiptLineId: line.id,
        productName: line.product.name,
        sku: line.product.sku,
        quantityText: line.presentation
          ? `${inTermsOf(captured, line.presentation, line.unitCode)} × ${formatDecimal(line.factor.toString())} = ${base}`
          : base,
        locationPath: pathOf(line.location),
        locationId: line.locationId,
        returnableQuantity: left.greaterThan(0) ? left.toFixed() : "0",
        returnableText: left.greaterThan(0)
          ? inTermsOf(left, line.presentation, line.unitCode)
          : null,
        returnedText: back.greaterThan(0)
          ? inTermsOf(back, line.presentation, line.unitCode)
          : null,
        unitText: line.presentation
          ? pluralizeName(line.presentation.name, dec(2)).toLowerCase()
          : getUnit(line.unitCode).plural,
      };
    }),
    ...(seeReturns
      ? {
          returns: receipt.returns.map((back) => ({
            id: back.id,
            createdAt: back.createdAt,
            authorName: names.get(back.returnedByUserId) ?? null,
            reason: back.reason,
            lines: back.lines.map((line) => {
              const quantity = dec(line.capturedQuantity.toString());
              const base = formatStock(
                quantity.times(line.factor.toString()).toString(),
                line.unitCode,
              );
              const presentation = line.receiptLine.presentation;
              return {
                productName: line.product.name,
                sku: line.product.sku,
                quantityText: presentation
                  ? `${inTermsOf(quantity, presentation, line.unitCode)} × ${formatDecimal(line.factor.toString())} = ${base}`
                  : base,
                locationPath: pathOf(line.location),
              };
            }),
          })),
        }
      : {}),
  }));

  return {
    canReceive:
      (order.status === "SENT" || order.status === "PARTIAL") &&
      lines.some((line) => line.pendingText !== null),
    canReturn: receipts.some((receipt) =>
      receipt.lines.some((line) => line.returnableText !== null),
    ),
    lines,
    receipts,
  };
}
