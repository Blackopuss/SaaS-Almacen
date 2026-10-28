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
 *
 * A sale on installments (PAG-08) first lowers what is owed: what comes
 * back, with its share of the interest, comes off the account, and only
 * what passes the balance is given back. The balance is never negative;
 * cancelling it gives back the down payment and the payments made.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Client = TenantDb | Tx;

const cents = (value: Decimal) =>
  value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const PICK_METHOD = "Elige cómo se devuelve el dinero.";
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
  /** What came back so far, VAT included. */
  refunded: string;
  /** Money to give back if all that is left comes back. */
  left: string;
  lines: ReturnableLine[];
  /** Methods it was paid with, to suggest how to give the money back. */
  paidWith: PaymentMethod[];
  /** The order it delivered (COT-07); null for a counter sale. */
  salesOrder: { id: string; number: number } | null;
  /** Sold on installments (PAG-04): what its account still owes. */
  account: { id: string; number: number; balance: string } | null;
  /** Returns so far, oldest first. */
  returns: {
    id: string;
    /** Money given back; «$0.00» when it all came off the account. */
    refund: string;
    refundMethod: PaymentMethod | null;
    /** Taken off the account (PAG-08); null for a cash sale. */
    credited: string | null;
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
      receivable: {
        select: { id: true, number: true, owed: true, interest: true },
      },
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
          accountCredit: {
            select: { goodsValue: true, interest: true, credited: true },
          },
        },
      },
    },
  });
}

type LoadedSale = NonNullable<Awaited<ReturnType<typeof loadSale>>>;

/** What a return brought back, VAT included (on installments, its goods). */
const valueOf = (r: LoadedSale["returns"][number]) =>
  dec((r.accountCredit?.goodsValue ?? r.refund).toString());

/** What an account still owes: owed − payments − returns. */
async function accountBalance(
  client: Client,
  account: { id: string; owed: { toString(): string } },
): Promise<Decimal> {
  const [payments, credits] = await Promise.all([
    client.salesReceivablePayment.aggregate({
      where: { receivableId: account.id },
      _sum: { amount: true },
    }),
    client.salesReceivableCredit.aggregate({
      where: { receivableId: account.id },
      _sum: { credited: true },
    }),
  ]);
  return dec(account.owed.toString())
    .minus(payments._sum.amount?.toString() ?? 0)
    .minus(credits._sum.credited?.toString() ?? 0);
}

/**
 * The share of the interest that goes with goods worth `value` (PAG-08):
 * interest × value ÷ total, to cents; what comes back last takes what is
 * left of it, so cents never get lost.
 */
function interestShare(sale: LoadedSale, value: Decimal, everything: boolean) {
  const interest = dec(sale.receivable?.interest.toString() ?? 0);
  if (everything) {
    const taken = sale.returns.reduce(
      (sum, r) => sum.plus(r.accountCredit?.interest.toString() ?? 0),
      dec(0),
    );
    return Decimal.max(interest.minus(taken), 0);
  }
  const total = dec(sale.total.toString());
  return total.isZero()
    ? dec(0)
    : cents(interest.times(value).dividedBy(total));
}

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
    (sum, r) => sum.plus(valueOf(r)),
    dec(0),
  );
  const goodsLeft = Decimal.max(dec(sale.total.toString()).minus(refunded), 0);
  const balance = sale.receivable
    ? await accountBalance(
        forOrganization(actor.organizationId),
        sale.receivable,
      )
    : null;
  const left = balance
    ? Decimal.max(
        goodsLeft.plus(interestShare(sale, goodsLeft, true)).minus(balance),
        0,
      )
    : goodsLeft;
  return {
    saleId: sale.id,
    number: sale.number,
    cancelled: sale.status === "CANCELLED",
    total: formatMoney(sale.total.toString()),
    refunded: formatMoney(refunded),
    left: formatMoney(left),
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
    account:
      sale.receivable && balance
        ? {
            id: sale.receivable.id,
            number: sale.receivable.number,
            balance: formatMoney(balance),
          }
        : null,
    returns: sale.returns.map((r) => ({
      id: r.id,
      refund: formatMoney(r.refund.toString()),
      refundMethod: r.refundMethod,
      credited: r.accountCredit
        ? formatMoney(r.accountCredit.credited.toString())
        : null,
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
      /** Taken off the account of a sale on installments (PAG-08). */
      credited?: string;
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
  // On installments it may all come off the account: then no method.
  const typedMethod = String(input.refundMethod ?? "");
  const method = typedMethod === "" ? null : (typedMethod as PaymentMethod);
  if (method !== null && !PAYMENT_METHODS.includes(method)) {
    fieldErrors.refundMethod = PICK_METHOD;
  }
  const reference = String(input.reference ?? "")
    .trim()
    .slice(0, 100);
  if (
    method !== null &&
    method !== "CASH" &&
    PAYMENT_METHODS.includes(method)
  ) {
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
      if (!sale.receivable && method === null) {
        throw new Rejected(
          failure({ fieldErrors: { refundMethod: PICK_METHOD } }),
        );
      }
      // On installments the account is locked too, after the sale.
      if (sale.receivable) {
        await lockRows(tx, "salesReceivable", [sale.receivable.id]);
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
        (sum, r) => sum.plus(valueOf(r)),
        dec(0),
      );
      const everything = sale.lines.every((line) => {
        const coming =
          back.find((b) => b.line.id === line.id)?.quantity ?? dec(0);
        return returnedOf(line)
          .plus(coming)
          .equals(line.capturedQuantity.toString());
      });
      const goodsValue = everything
        ? Decimal.max(dec(sale.total.toString()).minus(refundedSale), 0)
        : sale.pricesIncludeTax
          ? lines
          : lines.plus(
              cents(lines.times(sale.taxRate.toString()).dividedBy(100)),
            );
      // On installments it comes off what is owed first; only what passes
      // the balance is given back, so the balance is never negative.
      let refund = goodsValue;
      let credit: {
        receivableId: string;
        interest: Decimal;
        credited: Decimal;
        settles: boolean;
      } | null = null;
      if (sale.receivable) {
        const interest = interestShare(sale, goodsValue, everything);
        const balance = await accountBalance(tx, sale.receivable);
        const credited = Decimal.min(goodsValue.plus(interest), balance);
        refund = goodsValue.plus(interest).minus(credited);
        credit = {
          receivableId: sale.receivable.id,
          interest,
          credited,
          settles: balance.minus(credited).isZero(),
        };
      }
      const moneyMethod = refund.isZero() && credit ? null : method;
      if (moneyMethod === null && !refund.isZero()) {
        throw new Rejected(
          failure({
            fieldErrors: {
              refundMethod: `Se devuelven ${formatMoney(refund)}: ${PICK_METHOD.toLowerCase()}`,
            },
          }),
        );
      }

      if (moneyMethod === "CASH") {
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
          refundMethod: moneyMethod,
          refund: refund.toFixed(2),
          reference:
            moneyMethod === null || moneyMethod === "CASH" ? null : reference,
          cashSessionId: moneyMethod === "CASH" ? lockedSession! : null,
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
      if (credit) {
        await tx.salesReceivableCredit.create({
          data: {
            id: newId(),
            organizationId,
            receivableId: credit.receivableId,
            returnId,
            goodsValue: goodsValue.toFixed(2),
            interest: credit.interest.toFixed(2),
            credited: credit.credited.toFixed(2),
          },
        });
        // Cancelled with its sale; settled when nothing is owed any more.
        if (cancel) {
          await tx.salesReceivable.updateMany({
            where: { id: credit.receivableId, status: { not: "CANCELLED" } },
            data: { status: "CANCELLED" },
          });
        } else if (credit.settles) {
          await tx.salesReceivable.updateMany({
            where: { id: credit.receivableId, status: "OPEN" },
            data: { status: "PAID" },
          });
        }
      }
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
          ...(credit
            ? { descontadoDeLaCuenta: formatMoney(credit.credited) }
            : {}),
        },
      });
      return {
        ok: true as const,
        returnId,
        refund: formatMoney(refund),
        ...(credit ? { credited: formatMoney(credit.credited) } : {}),
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
