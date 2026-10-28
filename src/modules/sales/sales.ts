import "server-only";

import { dec, newId } from "@/lib";
import { postSaleExit } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { loadSubject, type Subject } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import { SALE_MAX_LINES, priceLines, type CartLineInput } from "./cart";
import { PERCENT_ERROR, formatPercent, parsePercent } from "./discounts";
import { SALE_MAX_PAYMENTS, readPayments, type PaymentInput } from "./payments";
import { formatMoney } from "./pricing";
import type { SalesActor } from "./prices";
import { checkDiscount } from "./sale-discount";
import { readTaxRule } from "./settings";
import { saleTotals } from "./tax";

/**
 * Confirming a counter sale (VEN-09..13, ADR 0030). One transaction writes
 * the sale, its lines and payments and the stock exit (`postSaleExit`):
 * all of it or nothing. Prices, VAT and change are computed here from what
 * is stored; the browser only sends products, quantities and payments.
 */

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export type SaleInput = {
  lines: CartLineInput[];
  /** Null or empty = público en general. */
  customerId?: string | null;
  payments: PaymentInput[];
  /** Discount of the whole sale (VEN-14); absent or 0 = none. */
  discount?: {
    /** As typed: «10». */
    percent?: string;
    reason?: string;
    /** From `authorizeDiscount`, when it is above the seller's cap. */
    authorizationId?: string;
  };
  /** Created with the screen; the same on every retry (INV-21). */
  idempotencyKey: string;
};

export type SaleResult =
  | {
      ok: true;
      saleId: string;
      number: number;
      /** «$1,234.50». */
      total: string;
      /** Cash change, «$65.50»; null without cash. */
      change: string | null;
      /** A retry of a sale already registered: nothing was written. */
      repeated?: true;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_allowed";
      /** Problem of each line, by its position in what was sent. */
      lineErrors: Record<number, string>;
      /** Problem of each payment, by its position. */
      paymentErrors: Record<number, string>;
      customerError?: string;
      /** The discount: its percent, reason or authorization. */
      discountError?: string;
      formError?: string;
    };

type Failure = Extract<SaleResult, { ok: false }>;

const failure = (patch: Partial<Failure>): Failure => ({
  ok: false,
  reason: "invalid",
  lineErrors: {},
  paymentErrors: {},
  ...patch,
});

/** Carries an expected failure out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("sale rejected");
  }
}

export const NO_CASH_SESSION =
  "Abre tu caja para cobrar: escribe con cuánto efectivo empiezas.";

export const SALE_KEY_REUSED =
  "Esta confirmación ya se usó para otra venta. Empieza una venta nueva.";

/** What the person typed, compared with what was stored. */
function sameQuantity(typed: string, stored: string): boolean {
  try {
    return dec(typed.replace(/,(?=\d{3}(\D|$))/g, "")).equals(stored);
  } catch {
    return false;
  }
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";

export async function registerSale(
  actor: SalesActor,
  input: SaleInput,
): Promise<SaleResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.sale.create");

  const key = text(input?.idempotencyKey, 64).trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    return failure({
      formError:
        "No pudimos identificar esta venta. Recarga la página e inténtalo de nuevo.",
    });
  }
  const sent = Array.isArray(input?.lines) ? input.lines : [];
  if (sent.length === 0) {
    return failure({ formError: "Agrega al menos un producto." });
  }
  if (sent.length > SALE_MAX_LINES) {
    return failure({
      formError: `Una venta admite hasta ${SALE_MAX_LINES} líneas. Cobra esta y sigue en otra.`,
    });
  }
  const lines: CartLineInput[] = sent.map((line) => ({
    productId: text(line?.productId, 36),
    capture: text(line?.capture, 40),
    quantity: text(line?.quantity, 40),
    locationId: text(line?.locationId, 36) || null,
  }));
  const customerId = text(input?.customerId, 36) || null;
  const typedPercent = text(input?.discount?.percent, 16).trim();
  const percent = typedPercent === "" ? "0.00" : parsePercent(typedPercent);
  if (percent === null) return failure({ discountError: PERCENT_ERROR });
  const discount = {
    percent,
    reason: text(input?.discount?.reason, 300).trim(),
    authorizationId: text(input?.discount?.authorizationId, 36) || null,
  };
  if (
    percent !== "0.00" &&
    (discount.reason.length < 3 ||
      discount.reason.length > 200 ||
      /[\u0000-\u001f]/.test(discount.reason))
  ) {
    return failure({
      discountError: "Escribe el motivo del descuento (de 3 a 200 caracteres).",
    });
  }
  // The seller's roles, read before the transaction (MOD-08): their cap
  // and whether they may sell below cost.
  const seller = await loadSubject(organizationId, userId);
  // One more than the limit, so it can say the list is too long.
  const payments = (Array.isArray(input?.payments) ? input.payments : []).slice(
    0,
    SALE_MAX_PAYMENTS + 1,
  );

  // Two sales of different products may take the same next number, or a
  // retry may race the first attempt: the database refuses the second and
  // it runs again, where it reads the number — or finds itself — anew.
  for (let attempt = 1; ; attempt++) {
    try {
      return await save(actor, {
        lines,
        customerId,
        payments,
        key,
        discount,
        seller,
      });
    } catch (error) {
      if (error instanceof Rejected) return error.result;
      if ((error as { code?: string }).code === "P2002" && attempt < 4) {
        continue;
      }
      throw error;
    }
  }
}

async function save(
  actor: SalesActor,
  input: {
    lines: CartLineInput[];
    customerId: string | null;
    payments: PaymentInput[];
    key: string;
    discount: {
      percent: string;
      reason: string;
      authorizationId: string | null;
    };
    seller: Subject;
  },
): Promise<SaleResult> {
  const { organizationId, userId } = actor;
  return forOrganization(organizationId).$transaction(async (tx) => {
    // Every product of the sale waits in line, always in the same order.
    await lockRows(
      tx,
      "product",
      input.lines.map((line) => line.productId),
    );

    const replay = await tx.sale.findFirst({
      where: { idempotencyKey: input.key },
      select: {
        id: true,
        number: true,
        total: true,
        soldByUserId: true,
        lines: {
          orderBy: { lineNumber: "asc" },
          select: {
            productId: true,
            presentationId: true,
            capturedQuantity: true,
          },
        },
        payments: { select: { changeGiven: true } },
      },
    });
    if (replay) {
      const same =
        replay.soldByUserId === userId &&
        replay.lines.length === input.lines.length &&
        input.lines.every((line, index) => {
          const stored = replay.lines[index]!;
          return (
            stored.productId === line.productId &&
            (line.capture === "base"
              ? stored.presentationId === null
              : `p:${stored.presentationId}` === line.capture) &&
            sameQuantity(line.quantity, stored.capturedQuantity.toString())
          );
        });
      if (!same) {
        throw new Rejected(
          failure({ reason: "not_allowed", formError: SALE_KEY_REUSED }),
        );
      }
      const change = replay.payments.find(
        (p) => p.changeGiven !== null && !p.changeGiven.isZero(),
      );
      return {
        ok: true as const,
        saleId: replay.id,
        number: replay.number,
        total: formatMoney(replay.total.toString()),
        change: change ? formatMoney(change.changeGiven!.toString()) : null,
        repeated: true as const,
      };
    }

    const cashSession = await lockOwnCashSession(tx, userId);
    if (!cashSession) {
      throw new Rejected(
        failure({ reason: "not_allowed", formError: NO_CASH_SESSION }),
      );
    }

    const { priced, lineErrors } = await priceLines(tx, input.lines);
    if (Object.keys(lineErrors).length > 0) {
      throw new Rejected(failure({ lineErrors }));
    }
    const sold = priced.map((line) => line!);

    if (input.customerId) {
      const customer = await tx.contact.findFirst({
        where: { id: input.customerId, isCustomer: true, archivedAt: null },
        select: { id: true },
      });
      if (!customer) {
        throw new Rejected(
          failure({
            reason: "not_found",
            customerError: "Ese cliente ya no existe. Elige otro o quítalo.",
          }),
        );
      }
    }

    // VEN-14: the discount comes off each line; above the seller's cap
    // it needs an authorization for them, unused and in time, and below
    // cost it needs a permission — theirs or the authorizer's.
    const discounted = dec(input.discount.percent).greaterThan(0);
    let discounts = sold.map(() => dec(0));
    let authorization: {
      id: string;
      authorizerUserId: string;
      belowCost: boolean;
    } | null = null;
    if (discounted) {
      const check = await checkDiscount(tx, {
        organizationId,
        seller: input.seller,
        percent: input.discount.percent,
        lines: sold,
      });
      discounts = check.discounts;
      if (input.discount.authorizationId) {
        const found = await tx.saleDiscountAuthorization.findFirst({
          where: {
            id: input.discount.authorizationId,
            sellerUserId: userId,
            expiresAt: { gt: new Date() },
            percent: { gte: input.discount.percent },
          },
          select: { id: true, authorizerUserId: true, belowCost: true },
        });
        const used = found
          ? await tx.sale.findFirst({
              where: { discountAuthorizationId: found.id },
              select: { id: true },
            })
          : null;
        if (!found || used) {
          throw new Rejected(
            failure({
              discountError:
                "La autorización ya no sirve: venció, ya se usó o es por menos. Pídela de nuevo.",
            }),
          );
        }
        authorization = found;
      }
      if (check.needsAuthorization && !authorization) {
        throw new Rejected(
          failure({
            reason: "not_allowed",
            discountError: `Tu tope de descuento es ${check.cap}. Pide que lo autorice un encargado.`,
          }),
        );
      }
      if (
        check.belowCost &&
        !check.mayGoBelowCost &&
        !authorization?.belowCost
      ) {
        throw new Rejected(
          failure({
            reason: "not_allowed",
            discountError:
              "Con este descuento hay productos por debajo de su costo: necesita la autorización de un administrador o del titular.",
          }),
        );
      }
    }
    const net = sold.map((line, index) => line.amount.minus(discounts[index]!));
    const discountTotal = discounts.reduce((sum, d) => sum.plus(d), dec(0));

    const rule = await readTaxRule(tx, organizationId);
    const totals = saleTotals(net, rule);
    const paid = readPayments(input.payments, totals.total);
    if (!paid.ok) {
      throw new Rejected(
        failure({
          paymentErrors: paid.paymentErrors,
          formError: paid.formError,
        }),
      );
    }

    const general = input.lines.some((line) => !line.locationId)
      ? await tx.location.findFirst({
          where: { isDefault: true },
          select: { id: true },
        })
      : null;
    const last = await tx.sale.findFirst({
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const number = (last?.number ?? 0) + 1;

    const exit = await postSaleExit(tx, actor, {
      reference: `Venta ${number}`,
      productNames: new Map(
        sold.map((line) => [line.productId, line.productName]),
      ),
      lines: sold.map((line, index) => ({
        productId: line.productId,
        locationId: input.lines[index]!.locationId || general?.id || "",
        capturedQuantity: line.capturedQuantity,
        presentationId: line.presentationId,
        presentationVersionId: line.presentationVersionId,
        factor: line.factor,
        unitCode: line.unitCode,
      })),
    });
    if (!exit.ok) {
      throw new Rejected(failure({ lineErrors: { [exit.line]: exit.error } }));
    }

    const saleId = newId();
    await tx.sale.create({
      data: {
        id: saleId,
        organizationId,
        number,
        customerId: input.customerId,
        movementId: exit.movementId,
        cashSessionId: cashSession.id,
        pricesIncludeTax: rule.pricesIncludeTax,
        taxRate: rule.rate,
        discount: discountTotal.toFixed(2),
        discountPercent: input.discount.percent,
        discountReason: discounted ? input.discount.reason : null,
        discountAuthorizationId: discounted
          ? (authorization?.id ?? null)
          : null,
        subtotal: totals.subtotal.toFixed(2),
        tax: totals.tax.toFixed(2),
        total: totals.total.toFixed(2),
        idempotencyKey: input.key,
        soldByUserId: userId,
      },
    });
    await tx.saleLine.createMany({
      data: sold.map((line, index) => ({
        id: newId(),
        organizationId,
        saleId,
        lineNumber: index + 1,
        productId: line.productId,
        locationId: input.lines[index]!.locationId || general?.id || "",
        capturedQuantity: line.capturedQuantity.toString(),
        presentationId: line.presentationId,
        presentationVersionId: line.presentationVersionId,
        factor: line.factor.toString(),
        baseQuantity: line.baseQuantity.toString(),
        unitCode: line.unitCode,
        unitPrice: line.unitPrice.toFixed(2),
        discount: discounts[index]!.toFixed(2),
        amount: net[index]!.toFixed(2),
        unitCost: exit.unitCosts[index] ?? null,
      })),
    });
    await tx.salePayment.createMany({
      data: paid.payments.map((payment, index) => ({
        id: newId(),
        organizationId,
        saleId,
        lineNumber: index + 1,
        method: payment.method,
        amount: payment.amount.toFixed(2),
        received: payment.received?.toFixed(2) ?? null,
        changeGiven: payment.change?.toFixed(2) ?? null,
        reference: payment.reference,
      })),
    });
    if (discounted) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "sales.discount_given",
        target: { type: "sale", id: saleId },
        reason: input.discount.reason,
        metadata: {
          venta: String(number),
          porcentaje: formatPercent(input.discount.percent),
          ...(authorization
            ? { authorizerUserId: authorization.authorizerUserId }
            : {}),
        },
      });
    }
    // Exact cash gives no change to announce.
    const change = paid.payments.find(
      (payment) => payment.change !== null && !payment.change.isZero(),
    );
    return {
      ok: true as const,
      saleId,
      number,
      total: formatMoney(totals.total),
      change: change ? formatMoney(change.change!) : null,
    };
  }, LOCKING_TRANSACTION);
}

/**
 * VEN-16: without an open register of who charges, nobody charges. The
 * register is locked so a close cannot happen in between: the sale lands
 * in it. Take it after the products.
 */
export async function lockOwnCashSession(
  tx: Parameters<Parameters<TenantDb["$transaction"]>[0]>[0],
  userId: string,
): Promise<{ id: string } | null> {
  const open = await tx.cashSession.findFirst({
    where: { openedByUserId: userId, isOpen: true },
    select: { id: true },
  });
  const [locked] = open ? await lockRows(tx, "cashSession", [open.id]) : [];
  return locked
    ? tx.cashSession.findFirst({
        where: { id: locked, isOpen: true },
        select: { id: true },
      })
    : null;
}

/**
 * After a lost answer (INV-22): whether this person's sale with that key
 * was registered.
 */
export async function findSaleByKey(
  actor: SalesActor,
  key: string,
): Promise<{ saleId: string; number: number } | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.create",
  );
  const value = text(key, 64);
  if (!IDEMPOTENCY_KEY.test(value)) return null;
  const sale = await forOrganization(actor.organizationId).sale.findFirst({
    where: { idempotencyKey: value, soldByUserId: actor.userId },
    select: { id: true, number: true },
  });
  return sale ? { saleId: sale.id, number: sale.number } : null;
}
