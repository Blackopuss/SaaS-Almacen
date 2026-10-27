import "server-only";

import { dec, newId } from "@/lib";
import { postSaleExit } from "@/modules/inventory";
import { assertModulePermission } from "@/platform/billing";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { SALE_MAX_LINES, priceLines, type CartLineInput } from "./cart";
import { SALE_MAX_PAYMENTS, readPayments, type PaymentInput } from "./payments";
import { formatMoney } from "./pricing";
import type { SalesActor } from "./prices";
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
      return await save(actor, { lines, customerId, payments, key });
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

    const rule = await readTaxRule(tx, organizationId);
    const totals = saleTotals(
      sold.map((line) => line.amount),
      rule,
    );
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
        pricesIncludeTax: rule.pricesIncludeTax,
        taxRate: rule.rate,
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
        amount: line.amount.toFixed(2),
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
