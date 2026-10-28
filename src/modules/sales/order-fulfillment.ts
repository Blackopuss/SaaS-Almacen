import "server-only";

import { Decimal, dec, newId } from "@/lib";
import {
  formatStock,
  listStockLocations,
  postSaleExit,
} from "@/modules/inventory";
import { assertModulePermission } from "@/platform/billing";
import { getUnit, parseQuantity, pluralizeName } from "@/platform/catalog";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import { discountLines, formatPercent } from "./discounts";
import { quantityText } from "./line-text";
import {
  SALE_MAX_PAYMENTS,
  paymentNote,
  readPayments,
  type PaymentInput,
} from "./payments";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";
import { NO_CASH_SESSION, SALE_KEY_REUSED, lockOwnCashSession } from "./sales";
import { awaitsFulfillment } from "./sales-order-states";
import { formatTaxRate, saleTotals } from "./tax";

/**
 * Fulfilling an order (COT-07, ADR 0030). There is no «fiado»: what leaves
 * for the customer is charged, so each delivery is a sale of the order,
 * at the prices, discount and VAT the customer accepted, with its stock
 * exit and its payments in the same transaction. Nothing is reserved
 * (COT-06): a delivery takes what is in stock at that moment; what is
 * missing stays pending.
 *
 * What was delivered counts even if it is later returned or its sale
 * cancelled: a return gives the merchandise back, it does not reopen the
 * order.
 */

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export type FulfillmentLineInput = {
  orderLineId: string;
  /** In the terms of the order's line (boxes when it says boxes). */
  quantity: string;
  /** Where it leaves from; empty = the default location. */
  locationId?: string | null;
};

export type FulfillmentInput = {
  lines: FulfillmentLineInput[];
  payments: PaymentInput[];
  /** Created with the screen; the same on every retry (INV-21). */
  idempotencyKey: string;
};

export type FulfillmentResult =
  | {
      ok: true;
      saleId: string;
      number: number;
      total: string;
      change: string | null;
      /** Nothing is missing anymore. */
      fulfilled: boolean;
      repeated?: true;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_allowed";
      /** By id of the order's line. */
      lineErrors: Record<string, string>;
      paymentErrors: Record<number, string>;
      formError?: string;
    };

type Failure = Extract<FulfillmentResult, { ok: false }>;

const failure = (patch: Partial<Failure>): Failure => ({
  ok: false,
  reason: "invalid",
  lineErrors: {},
  paymentErrors: {},
  ...patch,
});

class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("fulfillment rejected");
  }
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";

const cents = (amount: Decimal) =>
  amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** A company client or one of its transactions. */
type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/** What was delivered of each line of an order, in the line's terms. */
export async function deliveredByLine(
  client: Client,
  lineIds: readonly string[],
): Promise<Map<string, Decimal>> {
  if (lineIds.length === 0) return new Map();
  const rows = await client.saleLine.groupBy({
    by: ["orderLineId"],
    where: { orderLineId: { in: [...lineIds] } },
    _sum: { capturedQuantity: true },
  });
  return new Map(
    rows.map((row) => [
      row.orderLineId!,
      dec(row._sum.capturedQuantity?.toString() ?? 0),
    ]),
  );
}

type OrderToPlan = {
  discountPercent: { toString(): string };
  pricesIncludeTax: boolean;
  taxRate: { toString(): string };
  lines: {
    id: string;
    productId: string;
    unitCode: string;
    capturedQuantity: { toString(): string };
    factor: { toString(): string };
    unitPrice: { toString(): string };
    presentation: { name: string } | null;
    product: { name: string; quantityStep: { toString(): string } };
  }[];
};

/**
 * What a delivery takes of each line and what it adds up to: at the agreed
 * price, with the agreed discount off each line as at the counter (VEN-14).
 * Delivered whole in one go, it adds up to the order. Never more than what
 * is missing of a line. Reads only.
 */
async function planDelivery<Order extends OrderToPlan>(
  client: Client,
  order: Order,
  wanted: Map<string, { quantity: string; locationId: string }>,
) {
  const delivered = await deliveredByLine(
    client,
    order.lines.map((line) => line.id),
  );
  const lineErrors: Record<string, string> = {};
  const going: {
    line: Order["lines"][number];
    quantity: Decimal;
    locationId: string;
    missingAfter: Decimal;
  }[] = [];
  for (const line of order.lines) {
    const typed = wanted.get(line.id);
    if (!typed || typed.quantity === "" || typed.quantity === "0") continue;
    const parsed = parseQuantity(
      {
        unitCode: line.unitCode,
        quantityStep: line.presentation
          ? "1"
          : line.product.quantityStep.toString(),
      },
      typed.quantity,
    );
    if (!parsed.ok) {
      lineErrors[line.id] = line.presentation
        ? "Escribe cuántas completas entregas."
        : parsed.error;
      continue;
    }
    const missing = dec(line.capturedQuantity.toString()).minus(
      delivered.get(line.id) ?? 0,
    );
    if (parsed.quantity.greaterThan(missing)) {
      lineErrors[line.id] = missing.isZero()
        ? "De esta línea ya se entregó todo."
        : `Solo ${missing.equals(1) ? "falta" : "faltan"} ${quantityText({ ...line, capturedQuantity: missing })}.`;
      continue;
    }
    if (parsed.quantity.isZero()) continue;
    going.push({
      line,
      quantity: parsed.quantity,
      locationId: typed.locationId,
      missingAfter: missing.minus(parsed.quantity),
    });
  }
  const gross = going.map((g) =>
    cents(g.quantity.times(g.line.unitPrice.toString())),
  );
  const discounts = discountLines(gross, order.discountPercent.toString());
  const net = gross.map((amount, index) => amount.minus(discounts[index]!));
  const discountTotal = discounts.reduce((sum, d) => sum.plus(d), dec(0));
  const totals = saleTotals(net, {
    pricesIncludeTax: order.pricesIncludeTax,
    rate: order.taxRate.toString(),
  });
  return {
    delivered,
    lineErrors,
    going,
    discounts,
    net,
    discountTotal,
    totals,
  };
}

export const ORDER_NOT_WAITING: Record<string, string> = {
  FULFILLED: "Este pedido ya se surtió completo.",
  CANCELLED: "Este pedido está cancelado.",
};

/** Delivers part or all of an order and charges it, as one sale. */
export async function fulfillSalesOrder(
  actor: SalesActor,
  orderId: string,
  input: FulfillmentInput,
): Promise<FulfillmentResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.sale.create");

  const key = text(input?.idempotencyKey, 64).trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    return failure({
      formError:
        "No pudimos identificar esta entrega. Recarga la página e inténtalo de nuevo.",
    });
  }
  const id = text(orderId, 36);
  // The lines of an order never change (trigger): its products can be read
  // before taking their locks.
  const order = await forOrganization(organizationId).salesOrder.findFirst({
    where: { id },
    select: { id: true, lines: { select: { id: true, productId: true } } },
  });
  if (!order) {
    return failure({ reason: "not_found", formError: "Ese pedido no existe." });
  }
  const known = new Set(order.lines.map((line) => line.id));
  const wanted = new Map<string, { quantity: string; locationId: string }>();
  for (const line of Array.isArray(input?.lines) ? input.lines : []) {
    const lineId = text(line?.orderLineId, 36);
    if (!known.has(lineId) || wanted.has(lineId)) continue;
    wanted.set(lineId, {
      quantity: text(line?.quantity, 40).trim(),
      locationId: text(line?.locationId, 36),
    });
  }
  const payments = (Array.isArray(input?.payments) ? input.payments : []).slice(
    0,
    SALE_MAX_PAYMENTS + 1,
  );

  for (let attempt = 1; ; attempt++) {
    try {
      return await deliver(actor, {
        orderId: order.id,
        productIds: order.lines.map((line) => line.productId),
        wanted,
        payments,
        key,
      });
    } catch (error) {
      if (error instanceof Rejected) return error.result;
      // Two sales took the same number, or a retry raced the first try:
      // it runs again and reads the number, or finds itself, anew.
      if ((error as { code?: string }).code === "P2002" && attempt < 4) {
        continue;
      }
      throw error;
    }
  }
}

async function deliver(
  actor: SalesActor,
  input: {
    orderId: string;
    productIds: string[];
    wanted: Map<string, { quantity: string; locationId: string }>;
    payments: PaymentInput[];
    key: string;
  },
): Promise<FulfillmentResult> {
  const { organizationId, userId } = actor;
  return forOrganization(organizationId).$transaction(async (tx) => {
    // Products, then the register, then the order: the order of every sale.
    await lockRows(tx, "product", input.productIds);

    const replay = await tx.sale.findFirst({
      where: { idempotencyKey: input.key },
      select: {
        id: true,
        number: true,
        total: true,
        soldByUserId: true,
        salesOrderId: true,
        lines: { select: { orderLineId: true, capturedQuantity: true } },
        payments: { select: { changeGiven: true } },
        salesOrder: { select: { status: true } },
      },
    });
    if (replay) {
      const sent = [...input.wanted].filter(
        ([, line]) => line.quantity !== "" && line.quantity !== "0",
      );
      const same =
        replay.soldByUserId === userId &&
        replay.salesOrderId === input.orderId &&
        replay.lines.length === sent.length &&
        replay.lines.every((line) => {
          const typed = input.wanted.get(line.orderLineId ?? "")?.quantity;
          try {
            return (
              typed !== undefined &&
              dec(typed).equals(line.capturedQuantity.toString())
            );
          } catch {
            return false;
          }
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
        fulfilled: replay.salesOrder?.status === "FULFILLED",
        repeated: true as const,
      };
    }

    const cashSession = await lockOwnCashSession(tx, userId);
    if (!cashSession) {
      throw new Rejected(
        failure({ reason: "not_allowed", formError: NO_CASH_SESSION }),
      );
    }

    await lockRows(tx, "salesOrder", [input.orderId]);
    const order = await tx.salesOrder.findFirst({
      where: { id: input.orderId },
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
          include: {
            product: { select: { name: true, quantityStep: true } },
            presentation: { select: { name: true } },
          },
        },
      },
    });
    if (!order) {
      throw new Rejected(
        failure({ reason: "not_found", formError: "Ese pedido no existe." }),
      );
    }
    if (!awaitsFulfillment(order.status)) {
      throw new Rejected(
        failure({
          reason: "not_allowed",
          formError: ORDER_NOT_WAITING[order.status],
        }),
      );
    }

    // Never more than what is missing, read under the lock of the order.
    const plan = await planDelivery(tx, order, input.wanted);
    if (Object.keys(plan.lineErrors).length > 0) {
      throw new Rejected(failure({ lineErrors: plan.lineErrors }));
    }
    const { going, delivered, discounts, net, discountTotal, totals } = plan;
    if (going.length === 0) {
      throw new Rejected(
        failure({
          formError: "Escribe cuánto entregas de al menos un producto.",
        }),
      );
    }
    const paid = readPayments(input.payments, totals.total);
    if (!paid.ok) {
      throw new Rejected(
        failure({
          paymentErrors: paid.paymentErrors,
          formError: paid.formError,
        }),
      );
    }

    const general = going.some((g) => !g.locationId)
      ? await tx.location.findFirst({
          where: { isDefault: true },
          select: { id: true },
        })
      : null;
    const placeOf = (g: (typeof going)[number]) =>
      g.locationId || general?.id || "";
    const last = await tx.sale.findFirst({
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const number = (last?.number ?? 0) + 1;

    // With the content the customer accepted: «2 cajas de 500» stay 500.
    const exit = await postSaleExit(tx, actor, {
      reference: `Venta ${number} · Pedido ${order.number}`,
      productNames: new Map(
        going.map((g) => [g.line.productId, g.line.product.name]),
      ),
      lines: going.map((g) => ({
        productId: g.line.productId,
        locationId: placeOf(g),
        capturedQuantity: g.quantity,
        presentationId: g.line.presentationId,
        presentationVersionId: g.line.presentationVersionId,
        factor: dec(g.line.factor.toString()),
        unitCode: g.line.unitCode,
      })),
    });
    if (!exit.ok) {
      throw new Rejected(
        failure({ lineErrors: { [going[exit.line]!.line.id]: exit.error } }),
      );
    }

    const discounted = dec(order.discountPercent.toString()).greaterThan(0);
    const saleId = newId();
    await tx.sale.create({
      data: {
        id: saleId,
        organizationId,
        number,
        customerId: order.customerId,
        salesOrderId: order.id,
        movementId: exit.movementId,
        cashSessionId: cashSession.id,
        pricesIncludeTax: order.pricesIncludeTax,
        taxRate: order.taxRate,
        discount: discountTotal.toFixed(2),
        discountPercent: order.discountPercent,
        discountReason: discounted ? order.discountReason : null,
        subtotal: totals.subtotal.toFixed(2),
        tax: totals.tax.toFixed(2),
        total: totals.total.toFixed(2),
        idempotencyKey: input.key,
        soldByUserId: userId,
      },
    });
    await tx.saleLine.createMany({
      data: going.map((g, index) => ({
        id: newId(),
        organizationId,
        saleId,
        lineNumber: index + 1,
        productId: g.line.productId,
        locationId: placeOf(g),
        capturedQuantity: g.quantity.toString(),
        presentationId: g.line.presentationId,
        presentationVersionId: g.line.presentationVersionId,
        factor: g.line.factor.toString(),
        baseQuantity: g.quantity.times(g.line.factor.toString()).toString(),
        unitCode: g.line.unitCode,
        unitPrice: g.line.unitPrice.toString(),
        discount: discounts[index]!.toFixed(2),
        amount: net[index]!.toFixed(2),
        unitCost: exit.unitCosts[index] ?? null,
        orderLineId: g.line.id,
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

    const goingIds = new Set(going.map((g) => g.line.id));
    const fulfilled =
      going.every((g) => g.missingAfter.isZero()) &&
      order.lines.every(
        (line) =>
          goingIds.has(line.id) ||
          dec(line.capturedQuantity.toString()).equals(
            delivered.get(line.id) ?? 0,
          ),
      );
    const status = fulfilled ? "FULFILLED" : "PARTIAL";
    if (status !== order.status) {
      await tx.salesOrder.update({
        where: { id: order.id },
        data: { status },
      });
    }
    const change = paid.payments.find(
      (payment) => payment.change !== null && !payment.change.isZero(),
    );
    return {
      ok: true as const,
      saleId,
      number,
      total: formatMoney(totals.total),
      change: change ? formatMoney(change.change!) : null,
      fulfilled,
    };
  }, LOCKING_TRANSACTION);
}

export type FulfillmentLineView = {
  id: string;
  productName: string;
  sku: string;
  /** «2 cajas de 500 piezas». */
  orderedText: string;
  /** «1 caja de 500 piezas». */
  missingText: string;
  /** What is missing, in the line's terms: «1». */
  missing: string;
  /** How the quantity is typed: «cajas de 500 piezas», «metros». */
  unitLabel: string;
  /** «$500.00 c/u». */
  unitPrice: string;
  /** Locations that hold some of the product, the fullest first. */
  locations: { id: string; label: string }[];
  /** What can go now from the fullest location: the missing, or less. */
  suggested: string;
};

export type OrderToFulfill = {
  id: string;
  number: number;
  customerName: string;
  /** Why nothing can be delivered anymore; null while it can. */
  closed: string | null;
  /** Only the lines with something missing. */
  lines: FulfillmentLineView[];
};

/** An order as the delivery screen needs it; null when it does not exist. */
export async function getOrderToFulfill(
  actor: SalesActor,
  orderId: string,
): Promise<OrderToFulfill | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.create",
  );
  const client = forOrganization(actor.organizationId);
  const order = await client.salesOrder.findFirst({
    where: { id: text(orderId, 36) },
    include: {
      customer: { select: { name: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          product: { select: { name: true, sku: true } },
          presentation: { select: { name: true } },
        },
      },
    },
  });
  if (!order) return null;
  const head = {
    id: order.id,
    number: order.number,
    customerName: order.customer.name,
  };
  if (!awaitsFulfillment(order.status)) {
    return { ...head, closed: ORDER_NOT_WAITING[order.status]!, lines: [] };
  }
  const delivered = await deliveredByLine(
    client,
    order.lines.map((line) => line.id),
  );
  const pending = order.lines.filter((line) =>
    dec(line.capturedQuantity.toString()).greaterThan(
      delivered.get(line.id) ?? 0,
    ),
  );
  const places = await listStockLocations(actor);
  const balances = await client.stockBalance.findMany({
    where: {
      productId: { in: [...new Set(pending.map((l) => l.productId))] },
      quantity: { gt: 0 },
    },
    select: { productId: true, locationId: true, quantity: true },
  });
  return {
    ...head,
    closed: null,
    lines: pending.map((line) => {
      const missing = dec(line.capturedQuantity.toString()).minus(
        delivered.get(line.id) ?? 0,
      );
      const factor = dec(line.factor.toString());
      const held = places
        .map((place) => ({
          place,
          quantity: dec(
            balances
              .find(
                (b) =>
                  b.productId === line.productId && b.locationId === place.id,
              )
              ?.quantity.toString() ?? 0,
          ),
        }))
        .filter((row) => row.quantity.greaterThan(0))
        .sort((a, b) => b.quantity.comparedTo(a.quantity));
      // Whole boxes only: what the fullest location holds, in boxes.
      const fits = held[0]
        ? line.presentation
          ? held[0].quantity.dividedToIntegerBy(factor)
          : held[0].quantity
        : dec(0);
      const unit = getUnit(line.unitCode);
      return {
        id: line.id,
        productName: line.product.name,
        sku: line.product.sku,
        orderedText: quantityText(line),
        missingText: quantityText({ ...line, capturedQuantity: missing }),
        missing: missing.toString(),
        unitLabel: line.presentation
          ? `${pluralizeName(line.presentation.name, dec(2))} de ${factor.toString()} ${unit.plural}`
          : unit.plural,
        unitPrice: `${formatMoney(line.unitPrice.toString())} c/u`,
        locations: held.map(({ place, quantity }) => ({
          id: place.id,
          label: `${place.path} — hay ${formatStock(quantity.toString(), line.unitCode)}`,
        })),
        suggested: Decimal.min(missing, fits).toString(),
      };
    }),
  };
}

export type FulfillmentPreview = {
  /** Lines that go, by id of the order's line. */
  lines: Record<string, { amount: string; error?: string }>;
  /** Problems of lines that do not go, by id. */
  lineErrors: Record<string, string>;
  discount: { text: string; reason: string } | null;
  subtotal: string;
  taxLabel: string;
  tax: string;
  total: string;
  /** «Cambio: $95.50», «Faltan $4.50». */
  paymentNote: string | null;
};

/**
 * What a delivery adds up to before charging, with the same rules as
 * charging it. Says when a line asks for more than its location holds;
 * charging checks it again under the locks. Reads only.
 */
export async function previewFulfillment(
  actor: SalesActor,
  orderId: string,
  input: { lines: FulfillmentLineInput[]; payments?: PaymentInput[] },
): Promise<FulfillmentPreview | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.create",
  );
  const client = forOrganization(actor.organizationId);
  const order = await client.salesOrder.findFirst({
    where: { id: text(orderId, 36) },
    include: {
      lines: {
        include: {
          product: { select: { name: true, quantityStep: true } },
          presentation: { select: { name: true } },
        },
      },
    },
  });
  if (!order || !awaitsFulfillment(order.status)) return null;
  const wanted = new Map<string, { quantity: string; locationId: string }>();
  for (const line of Array.isArray(input?.lines) ? input.lines : []) {
    const lineId = text(line?.orderLineId, 36);
    if (wanted.has(lineId)) continue;
    wanted.set(lineId, {
      quantity: text(line?.quantity, 40).trim(),
      locationId: text(line?.locationId, 36),
    });
  }
  const plan = await planDelivery(client, order, wanted);
  const general = plan.going.some((g) => !g.locationId)
    ? await client.location.findFirst({
        where: { isDefault: true },
        select: { id: true },
      })
    : null;
  const placeOf = (g: (typeof plan.going)[number]) =>
    g.locationId || general?.id || "";
  const balances = await client.stockBalance.findMany({
    where: {
      OR: plan.going.map((g) => ({
        productId: g.line.productId,
        locationId: placeOf(g),
      })),
    },
    select: { productId: true, locationId: true, quantity: true },
  });
  // Several lines of one product from one place share what it holds.
  const taken = new Map<string, Decimal>();
  const lines: FulfillmentPreview["lines"] = {};
  plan.going.forEach((g, index) => {
    const slot = `${g.line.productId}|${placeOf(g)}`;
    const held = dec(
      balances
        .find(
          (b) =>
            b.productId === g.line.productId && b.locationId === placeOf(g),
        )
        ?.quantity.toString() ?? 0,
    );
    const after = (taken.get(slot) ?? dec(0)).plus(
      g.quantity.times(g.line.factor.toString()),
    );
    taken.set(slot, after);
    lines[g.line.id] = {
      amount: formatMoney(plan.net[index]!),
      ...(after.greaterThan(held)
        ? {
            error: held.isZero()
              ? "Ahí ya no hay de este producto."
              : `Ahí solo hay ${formatStock(held.toString(), g.line.unitCode)}.`,
          }
        : {}),
    };
  });
  const rate = formatTaxRate(order.taxRate.toString());
  return {
    lines,
    lineErrors: plan.lineErrors,
    discount: plan.discountTotal.isZero()
      ? null
      : {
          text: `-${formatMoney(plan.discountTotal)} (${formatPercent(order.discountPercent.toString())})`,
          reason: order.discountReason ?? "",
        },
    subtotal: formatMoney(plan.totals.subtotal),
    taxLabel: order.pricesIncludeTax
      ? `IVA incluido (${rate})`
      : `IVA (${rate})`,
    tax: formatMoney(plan.totals.tax),
    total: formatMoney(plan.totals.total),
    paymentNote:
      plan.going.length > 0
        ? paymentNote(
            (Array.isArray(input?.payments) ? input.payments : []).slice(
              0,
              SALE_MAX_PAYMENTS,
            ),
            plan.totals.total,
          )
        : null,
  };
}
