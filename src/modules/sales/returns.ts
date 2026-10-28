import "server-only";

import { Decimal, dec, newId } from "@/lib";
import { postSaleReturnEntry } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { getUnit, parseQuantity } from "@/platform/catalog";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import { cashTotals } from "./cash";
import { NO_CASH_SESSION } from "./sales";
import { PAYMENT_METHODS, type PaymentMethod } from "./payments";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";

/**
 * Returns and cancellations (VEN-19..21, ADR 0030). The goods come back to
 * stock at the cost they left with; the money goes back by the method
 * chosen — cash out of the open register of who gives it back. Never more
 * than what was sold of each line. The last return of a sale gives back
 * exactly what is left of its total, so cents never get lost.
 * Cancelling a sale is returning all that is left and marking it.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Client = TenantDb | Tx;

const cents = (value: Decimal) =>
  value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

export type ReturnableLine = {
  saleLineId: string;
  name: string;
  /** «caja de 500 piezas», «metros». */
  unitLabel: string;
  sold: string;
  returned: string;
  /** What can still come back, in the terms it was sold. */
  returnable: string;
  /** Price of one, after the discount: «$475.00». */
  unitPrice: string;
};

export type ReturnableSale = {
  saleId: string;
  number: number;
  cancelled: boolean;
  total: string;
  /** Already given back. */
  refunded: string;
  /** What is still to give back if all that is left comes back. */
  left: string;
  lines: ReturnableLine[];
  /** Methods it was paid with, to suggest how to give the money back. */
  paidWith: PaymentMethod[];
  /** The order it delivered (COT-07); null for a counter sale. */
  salesOrder: { id: string; number: number } | null;
  /** Returns so far, oldest first. */
  returns: {
    id: string;
    refund: string;
    refundMethod: PaymentMethod;
    cancelsSale: boolean;
  }[];
};

async function loadSale(client: Client, saleId: string) {
  return client.sale.findFirst({
    where: { id: saleId },
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      pricesIncludeTax: true,
      taxRate: true,
      salesOrder: { select: { id: true, number: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true,
          productId: true,
          locationId: true,
          capturedQuantity: true,
          presentationId: true,
          presentationVersionId: true,
          factor: true,
          unitCode: true,
          amount: true,
          unitCost: true,
          product: { select: { name: true, quantityStep: true } },
          presentation: { select: { name: true } },
          returnLines: { select: { capturedQuantity: true, refund: true } },
        },
      },
      payments: { select: { method: true } },
      returns: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          refund: true,
          refundMethod: true,
          cancelsSale: true,
        },
      },
    },
  });
}

type LoadedSale = NonNullable<Awaited<ReturnType<typeof loadSale>>>;

const returnedOf = (line: LoadedSale["lines"][number]) =>
  line.returnLines.reduce(
    (sum, r) => sum.plus(r.capturedQuantity.toString()),
    dec(0),
  );

function unitLabelOf(line: LoadedSale["lines"][number]): string {
  const unit = getUnit(line.unitCode);
  return line.presentation
    ? `${line.presentation.name.toLowerCase()} de ${dec(line.factor.toString()).toString()} ${unit.plural}`
    : unit.plural;
}

/** What can still come back of a sale. */
export async function getReturnableSale(
  actor: SalesActor,
  saleId: string,
): Promise<ReturnableSale | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.read",
  );
  const sale = await loadSale(
    forOrganization(actor.organizationId),
    String(saleId).slice(0, 36),
  );
  if (!sale) return null;
  const refunded = sale.returns.reduce(
    (sum, r) => sum.plus(r.refund.toString()),
    dec(0),
  );
  return {
    saleId: sale.id,
    number: sale.number,
    cancelled: sale.status === "CANCELLED",
    total: formatMoney(sale.total.toString()),
    refunded: formatMoney(refunded),
    left: formatMoney(
      Decimal.max(dec(sale.total.toString()).minus(refunded), 0),
    ),
    lines: sale.lines.map((line) => {
      const sold = dec(line.capturedQuantity.toString());
      const returned = returnedOf(line);
      return {
        saleLineId: line.id,
        name: line.product.name,
        unitLabel: unitLabelOf(line),
        sold: sold.toString(),
        returned: returned.toString(),
        returnable: sold.minus(returned).toString(),
        unitPrice: formatMoney(
          cents(dec(line.amount.toString()).dividedBy(sold)),
        ),
      };
    }),
    paidWith: [...new Set(sale.payments.map((p) => p.method as PaymentMethod))],
    salesOrder: sale.salesOrder,
    returns: sale.returns.map((r) => ({
      id: r.id,
      refund: formatMoney(r.refund.toString()),
      refundMethod: r.refundMethod,
      cancelsSale: r.cancelsSale,
    })),
  };
}

/** After a lost answer: this person's return with that key, if any. */
export async function findReturnByKey(
  actor: SalesActor,
  key: string,
): Promise<{
  returnId: string;
  saleId: string;
  refund: string;
  cancelsSale: boolean;
} | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.read",
  );
  const value = String(key ?? "").trim();
  if (!IDEMPOTENCY_KEY.test(value)) return null;
  const found = await forOrganization(
    actor.organizationId,
  ).saleReturn.findFirst({
    where: { idempotencyKey: value, createdByUserId: actor.userId },
    select: { id: true, saleId: true, refund: true, cancelsSale: true },
  });
  return found
    ? {
        returnId: found.id,
        saleId: found.saleId,
        refund: formatMoney(found.refund.toString()),
        cancelsSale: found.cancelsSale,
      }
    : null;
}

export type ReturnInput = {
  /** What comes back of each line, as typed; empty or 0 = nothing. */
  lines: { saleLineId: string; quantity: string }[];
  reason: string;
  refundMethod: string;
  /** Card or transfer. */
  reference?: string;
  idempotencyKey: string;
};

export type ReturnResult =
  | {
      ok: true;
      returnId: string;
      /** «$503.00» given back. */
      refund: string;
      repeated?: true;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_allowed";
      /** By sale line id. */
      lineErrors: Record<string, string>;
      fieldErrors: Partial<
        Record<"reason" | "refundMethod" | "reference", string>
      >;
      formError?: string;
    };

type Failure = Extract<ReturnResult, { ok: false }>;
const failure = (patch: Partial<Failure>): Failure => ({
  ok: false,
  reason: "invalid",
  lineErrors: {},
  fieldErrors: {},
  ...patch,
});

class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("return rejected");
  }
}

/** Returns goods of a sale and gives their money back (VEN-19/20). */
export async function returnSale(
  actor: SalesActor,
  saleId: string,
  input: ReturnInput,
): Promise<ReturnResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.return.create",
  );
  return process(actor, saleId, input, false);
}

/**
 * Cancels a sale (VEN-21): what is left of it comes back and its money is
 * given back; the sale stays, marked as cancelled, with its reason.
 */
export async function cancelSale(
  actor: SalesActor,
  saleId: string,
  input: Omit<ReturnInput, "lines">,
): Promise<ReturnResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.cancel",
  );
  return process(actor, saleId, { ...input, lines: [] }, true);
}

async function process(
  actor: SalesActor,
  saleId: string,
  input: ReturnInput,
  cancel: boolean,
  attempt = 0,
): Promise<ReturnResult> {
  const { organizationId, userId } = actor;
  const fieldErrors: Failure["fieldErrors"] = {};
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 500 || !NO_CONTROL.test(reason)) {
    fieldErrors.reason = "Escribe el motivo (de 3 a 500 caracteres).";
  }
  const method = String(input.refundMethod ?? "") as PaymentMethod;
  if (!PAYMENT_METHODS.includes(method)) {
    fieldErrors.refundMethod = "Elige cómo se devuelve el dinero.";
  }
  const reference = String(input.reference ?? "")
    .trim()
    .slice(0, 100);
  if (method !== "CASH" && PAYMENT_METHODS.includes(method)) {
    if (
      reference === "" ||
      reference.length > 60 ||
      !NO_CONTROL.test(reference)
    ) {
      fieldErrors.reference =
        method === "CARD"
          ? "Escribe el número de autorización de la devolución en la terminal."
          : "Escribe la referencia de la transferencia (hasta 60 caracteres).";
    }
  }
  const key = String(input.idempotencyKey ?? "").trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    return failure({
      formError: "No pudimos identificar esta devolución. Recarga la página.",
    });
  }
  if (Object.keys(fieldErrors).length > 0) return failure({ fieldErrors });
  const id = String(saleId).slice(0, 36);
  const wanted = new Map(
    (Array.isArray(input.lines) ? input.lines : [])
      .slice(0, 100)
      .map((line) => [
        String(line?.saleLineId ?? "").slice(0, 36),
        String(line?.quantity ?? "")
          .trim()
          .slice(0, 40),
      ]),
  );

  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      // Products, then the register, then the sale: the order of a sale.
      const lineProducts = await tx.saleLine.findMany({
        where: { saleId: id },
        select: { productId: true },
      });
      await lockRows(
        tx,
        "product",
        lineProducts.map((line) => line.productId),
      );
      const open =
        method === "CASH"
          ? await tx.cashSession.findFirst({
              where: { openedByUserId: userId, isOpen: true },
              select: { id: true },
            })
          : null;
      const [lockedSession] = open
        ? await lockRows(tx, "cashSession", [open.id])
        : [];
      const [lockedSale] = await lockRows(tx, "sale", [id]);

      const replay = await tx.saleReturn.findFirst({
        where: { idempotencyKey: key },
        select: { id: true, saleId: true, refund: true, createdByUserId: true },
      });
      if (replay) {
        if (replay.saleId !== id || replay.createdByUserId !== userId) {
          throw new Rejected(
            failure({
              reason: "not_allowed",
              formError: "Esta confirmación ya se usó. Recarga la página.",
            }),
          );
        }
        return {
          ok: true as const,
          returnId: replay.id,
          refund: formatMoney(replay.refund.toString()),
          repeated: true as const,
        };
      }

      const sale = lockedSale ? await loadSale(tx, lockedSale) : null;
      if (!sale) {
        throw new Rejected(
          failure({ reason: "not_found", formError: "Esa venta no existe." }),
        );
      }
      if (sale.status === "CANCELLED") {
        throw new Rejected(
          failure({
            reason: "not_allowed",
            formError: "Esta venta ya está cancelada.",
          }),
        );
      }

      // What comes back of each line, never more than what is left.
      const lineErrors: Record<string, string> = {};
      const back: {
        line: LoadedSale["lines"][number];
        quantity: Decimal;
        refund: Decimal;
      }[] = [];
      for (const line of sale.lines) {
        const sold = dec(line.capturedQuantity.toString());
        const left = sold.minus(returnedOf(line));
        let quantity: Decimal;
        if (cancel) {
          quantity = left;
        } else {
          const typed = wanted.get(line.id) ?? "";
          if (typed === "" || typed === "0") continue;
          const parsed = parseQuantity(
            {
              unitCode: line.unitCode,
              quantityStep: line.presentation
                ? "1"
                : line.product.quantityStep.toString(),
            },
            typed,
          );
          if (!parsed.ok) {
            lineErrors[line.id] = line.presentation
              ? "Escribe cuántas completas regresan."
              : parsed.error;
            continue;
          }
          quantity = parsed.quantity;
          if (quantity.greaterThan(left)) {
            lineErrors[line.id] = left.isZero()
              ? "De esta línea ya se devolvió todo."
              : `Solo quedan ${left.toString()} por devolver.`;
            continue;
          }
        }
        if (quantity.isZero()) continue;
        const amount = dec(line.amount.toString());
        const refundedLine = line.returnLines.reduce(
          (sum, r) => sum.plus(r.refund.toString()),
          dec(0),
        );
        // The last of a line gives back what is left of its amount.
        const refund = quantity.equals(left)
          ? amount.minus(refundedLine)
          : cents(amount.times(quantity).dividedBy(sold));
        back.push({ line, quantity, refund });
      }
      if (Object.keys(lineErrors).length > 0) {
        throw new Rejected(failure({ lineErrors }));
      }
      if (back.length === 0) {
        throw new Rejected(
          failure({
            formError: cancel
              ? "De esta venta ya se devolvió todo."
              : "Escribe cuánto regresa de al menos un producto.",
          }),
        );
      }

      // VAT as the sale charged it; the last return closes the total.
      const lines = back.reduce((sum, b) => sum.plus(b.refund), dec(0));
      const refundedSale = sale.returns.reduce(
        (sum, r) => sum.plus(r.refund.toString()),
        dec(0),
      );
      const everything = sale.lines.every((line) => {
        const coming =
          back.find((b) => b.line.id === line.id)?.quantity ?? dec(0);
        return returnedOf(line)
          .plus(coming)
          .equals(line.capturedQuantity.toString());
      });
      const refund = everything
        ? Decimal.max(dec(sale.total.toString()).minus(refundedSale), 0)
        : sale.pricesIncludeTax
          ? lines
          : lines.plus(
              cents(lines.times(sale.taxRate.toString()).dividedBy(100)),
            );

      if (method === "CASH") {
        const session = lockedSession
          ? await tx.cashSession.findFirst({
              where: { id: lockedSession, isOpen: true },
              select: { id: true },
            })
          : null;
        if (!session) {
          throw new Rejected(
            failure({ reason: "not_allowed", formError: NO_CASH_SESSION }),
          );
        }
        const totals = await cashTotals(tx, session.id);
        if (totals.expectedCash.lessThan(refund)) {
          throw new Rejected(
            failure({
              reason: "not_allowed",
              fieldErrors: {
                refundMethod: `En tu caja debería haber ${formatMoney(totals.expectedCash)}: no alcanza para devolver ${formatMoney(refund)} en efectivo.`,
              },
            }),
          );
        }
      }

      const entry = await postSaleReturnEntry(tx, actor, {
        reference: `Venta ${sale.number}`,
        reason,
        lines: back.map((b) => ({
          productId: b.line.productId,
          locationId: b.line.locationId,
          capturedQuantity: b.quantity,
          presentationId: b.line.presentationId,
          presentationVersionId: b.line.presentationVersionId,
          factor: dec(b.line.factor.toString()),
          unitCode: b.line.unitCode,
          unitCost: b.line.unitCost,
        })),
      });
      if (!entry.ok) {
        throw new Rejected(
          failure({ lineErrors: { [back[entry.line]!.line.id]: entry.error } }),
        );
      }

      const returnId = newId();
      await tx.saleReturn.create({
        data: {
          id: returnId,
          organizationId,
          saleId: sale.id,
          movementId: entry.movementId,
          refundMethod: method,
          refund: refund.toFixed(2),
          reference: method === "CASH" ? null : reference,
          cashSessionId: method === "CASH" ? lockedSession! : null,
          reason,
          cancelsSale: cancel,
          idempotencyKey: key,
          createdByUserId: userId,
        },
      });
      await tx.saleReturnLine.createMany({
        data: back.map((b, index) => ({
          id: newId(),
          organizationId,
          returnId,
          lineNumber: index + 1,
          saleLineId: b.line.id,
          productId: b.line.productId,
          locationId: entry.locationIds[index]!,
          capturedQuantity: b.quantity.toString(),
          presentationId: b.line.presentationId,
          presentationVersionId: b.line.presentationVersionId,
          factor: b.line.factor.toString(),
          baseQuantity: b.quantity.times(b.line.factor.toString()).toString(),
          unitCode: b.line.unitCode,
          unitCost: b.line.unitCost?.toString() ?? null,
          refund: b.refund.toFixed(2),
        })),
      });
      if (cancel) {
        await tx.sale.updateMany({
          where: { id: sale.id, status: "COMPLETED" },
          data: {
            status: "CANCELLED",
            cancelledByUserId: userId,
            cancelledAt: new Date(),
            cancelReason: reason,
          },
        });
      }
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: cancel ? "sales.cancelled" : "sales.returned",
        target: { type: "sale", id: sale.id },
        reason,
        metadata: {
          venta: String(sale.number),
          importe: formatMoney(refund),
        },
      });
      return {
        ok: true as const,
        returnId,
        refund: formatMoney(refund),
      };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    // The same key arrived twice at once: the second finds the first.
    if ((error as { code?: string }).code === "P2002" && attempt < 3) {
      return process(actor, saleId, input, cancel, attempt + 1);
    }
    throw error;
  }
}
