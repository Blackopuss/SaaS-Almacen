import "server-only";

import { dec, formatDateTime, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { formatPercent } from "./discounts";
import { quantityText } from "./line-text";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";
import { deliveredByLine } from "./order-fulfillment";
import type { SalesOrderStatus } from "./sales-order-states";
import { formatTaxRate, saleTotals } from "./tax";

/**
 * Sales orders (COT-05, ADR 0030): an accepted quote becomes an order with
 * the prices, discount and VAT rule the customer accepted, copied line by
 * line. One order per quote: converting it again answers with the same
 * order. An order does not touch stock until it is fulfilled: each
 * delivery is a sale of the order (COT-07, `order-fulfillment.ts`).
 */

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  OPEN: "Por surtir",
  PARTIAL: "Surtido en parte",
  FULFILLED: "Surtido",
  CANCELLED: "Cancelado",
};

export type ConvertQuoteResult =
  | { ok: true; orderId: string; number: number; repeated?: true }
  | { ok: false; reason: "not_found" | "invalid_state"; error: string };

type Failure = Extract<ConvertQuoteResult, { ok: false }>;

class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("conversion rejected");
  }
}

const STATE_PROBLEM: Record<string, string> = {
  DRAFT: "Primero envía la cotización y márcala como aceptada.",
  SENT: "Primero marca la cotización como aceptada.",
  REJECTED: "Esta cotización se rechazó: no se convierte en pedido.",
};

/** Turns an accepted quote into its order. */
export async function convertQuoteToOrder(
  actor: SalesActor,
  quoteId: string,
  attempt = 0,
): Promise<ConvertQuoteResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.quote.create");
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      const [id] = await lockRows(tx, "salesQuote", [
        String(quoteId).slice(0, 36),
      ]);
      const quote = id
        ? await tx.salesQuote.findFirst({
            where: { id },
            include: {
              order: { select: { id: true, number: true } },
              lines: { orderBy: { lineNumber: "asc" } },
            },
          })
        : null;
      if (!quote) {
        throw new Rejected({
          ok: false,
          reason: "not_found",
          error: "Esa cotización no existe.",
        });
      }
      if (quote.order) {
        return {
          ok: true as const,
          orderId: quote.order.id,
          number: quote.order.number,
          repeated: true as const,
        };
      }
      if (quote.status !== "ACCEPTED") {
        throw new Rejected({
          ok: false,
          reason: "invalid_state",
          error:
            STATE_PROBLEM[quote.status] ?? "Esta cotización no se convierte.",
        });
      }
      const last = await tx.salesOrder.findFirst({
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;
      const orderId = newId();
      await tx.salesOrder.create({
        data: {
          id: orderId,
          organizationId,
          number,
          quoteId: quote.id,
          customerId: quote.customerId,
          pricesIncludeTax: quote.pricesIncludeTax,
          taxRate: quote.taxRate,
          discountPercent: quote.discountPercent,
          discountReason: quote.discountReason,
          notes: quote.notes,
          createdByUserId: userId,
        },
      });
      await tx.salesOrderLine.createMany({
        data: quote.lines.map((line) => ({
          id: newId(),
          organizationId,
          orderId,
          lineNumber: line.lineNumber,
          productId: line.productId,
          capturedQuantity: line.capturedQuantity,
          presentationId: line.presentationId,
          presentationVersionId: line.presentationVersionId,
          factor: line.factor,
          baseQuantity: line.baseQuantity,
          unitCode: line.unitCode,
          unitPrice: line.unitPrice,
          discount: line.discount,
          amount: line.amount,
        })),
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "sales.order_created",
        target: { type: "sales_order", id: orderId },
        metadata: {
          pedido: String(number),
          cotizacion: String(quote.number),
        },
      });
      return { ok: true as const, orderId, number };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    // Two orders took the same number, or the same quote twice at once:
    // the second reads again and finds what the first did.
    if ((error as { code?: string }).code === "P2002" && attempt < 3) {
      return convertQuoteToOrder(actor, quoteId, attempt + 1);
    }
    throw error;
  }
}

export type SalesOrderView = {
  id: string;
  number: number;
  status: SalesOrderStatus;
  statusLabel: string;
  quote: { id: string; number: number };
  customer: {
    id: string;
    name: string;
    phone: string | null;
    rfc: string | null;
  };
  notes: string | null;
  createdBy: string | null;
  createdAtText: string;
  lines: {
    id: string;
    productId: string;
    productName: string;
    sku: string;
    quantityText: string;
    unitPrice: string;
    /** Before the discount. */
    amount: string;
    /** What is still missing, in the line's terms: «1», «0.5». */
    missing: string;
    /** «1 caja de 500 piezas»; null when nothing was delivered yet. */
    deliveredText: string | null;
    /** «1 caja de 500 piezas»; null when nothing is missing. */
    missingText: string | null;
  }[];
  /** Who cancelled it, when and why (COT-09); null while it is not. */
  cancellation: { by: string | null; atText: string; reason: string } | null;
  /** Its deliveries: each one a sale (COT-07), oldest first. */
  sales: {
    id: string;
    number: number;
    createdAtText: string;
    total: string;
    cancelled: boolean;
  }[];
  discount: { text: string; reason: string } | null;
  subtotal: string;
  taxLabel: string;
  tax: string;
  total: string;
};

/** An order of the company with its totals; null when it does not exist. */
export async function getSalesOrder(
  actor: SalesActor,
  orderId: string,
): Promise<SalesOrderView | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.quote.read",
  );
  const client = forOrganization(actor.organizationId);
  const order = await client.salesOrder.findFirst({
    where: { id: String(orderId).slice(0, 36) },
    include: {
      organization: { select: { timeZone: true } },
      quote: { select: { id: true, number: true } },
      customer: { select: { id: true, name: true, phone: true, rfc: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        include: {
          product: { select: { name: true, sku: true } },
          presentation: { select: { name: true } },
        },
      },
      sales: {
        orderBy: { number: "asc" },
        select: {
          id: true,
          number: true,
          createdAt: true,
          total: true,
          status: true,
        },
      },
    },
  });
  if (!order) return null;
  const timeZone = order.organization.timeZone || "America/Mexico_City";
  const delivered = await deliveredByLine(
    client,
    order.lines.map((line) => line.id),
  );
  const author = await client.membership.findFirst({
    where: { userId: order.createdByUserId },
    select: { user: { select: { name: true } } },
  });
  const canceller = order.cancelledByUserId
    ? await client.membership.findFirst({
        where: { userId: order.cancelledByUserId },
        select: { user: { select: { name: true } } },
      })
    : null;
  const totals = saleTotals(
    order.lines.map((line) => line.amount.toString()),
    {
      pricesIncludeTax: order.pricesIncludeTax,
      rate: order.taxRate.toString(),
    },
  );
  const off = order.lines.reduce(
    (sum, line) => sum.plus(line.discount.toString()),
    dec(0),
  );
  const rate = formatTaxRate(order.taxRate.toString());
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    statusLabel: SALES_ORDER_STATUS_LABELS[order.status],
    quote: order.quote,
    customer: order.customer,
    notes: order.notes,
    createdBy: author?.user.name ?? null,
    createdAtText: formatDateTime(order.createdAt, timeZone),
    lines: order.lines.map((line) => {
      const done = delivered.get(line.id) ?? dec(0);
      const missing = dec(line.capturedQuantity.toString()).minus(done);
      return {
        id: line.id,
        productId: line.productId,
        productName: line.product.name,
        sku: line.product.sku,
        quantityText: quantityText(line),
        unitPrice: `${formatMoney(line.unitPrice.toString())} c/u`,
        amount: formatMoney(
          dec(line.amount.toString()).plus(line.discount.toString()),
        ),
        missing: missing.toString(),
        deliveredText: done.isZero()
          ? null
          : quantityText({ ...line, capturedQuantity: done }),
        missingText: missing.isZero()
          ? null
          : quantityText({ ...line, capturedQuantity: missing }),
      };
    }),
    cancellation:
      order.status === "CANCELLED" && order.cancelledAt
        ? {
            by: canceller?.user.name ?? null,
            atText: formatDateTime(order.cancelledAt, timeZone),
            reason: order.cancelReason ?? "",
          }
        : null,
    sales: order.sales.map((sale) => ({
      id: sale.id,
      number: sale.number,
      createdAtText: formatDateTime(sale.createdAt, timeZone),
      total: formatMoney(sale.total.toString()),
      cancelled: sale.status === "CANCELLED",
    })),
    discount: off.isZero()
      ? null
      : {
          text: `-${formatMoney(off)} (${formatPercent(order.discountPercent.toString())})`,
          reason: order.discountReason ?? "",
        },
    subtotal: formatMoney(totals.subtotal),
    taxLabel: order.pricesIncludeTax
      ? `IVA incluido (${rate})`
      : `IVA (${rate})`,
    tax: formatMoney(totals.tax),
    total: formatMoney(totals.total),
  };
}

export const SALES_ORDER_PAGE_SIZE = 25;

export type SalesOrderSummary = {
  id: string;
  number: number;
  quoteNumber: number;
  customer: string;
  status: SalesOrderStatus;
  statusLabel: string;
  createdAt: Date;
  total: string;
};

/** Orders of the company, newest first, one page at a time. */
export async function listSalesOrders(
  actor: SalesActor,
  filters: { page?: number } = {},
): Promise<{
  items: SalesOrderSummary[];
  total: number;
  page: number;
  pageCount: number;
}> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.quote.read",
  );
  const client = forOrganization(actor.organizationId);
  const total = await client.salesOrder.count();
  const pageCount = Math.max(1, Math.ceil(total / SALES_ORDER_PAGE_SIZE));
  const requested = Number.isInteger(filters.page) ? Number(filters.page) : 1;
  const page = Math.min(Math.max(requested, 1), pageCount);
  const rows = await client.salesOrder.findMany({
    orderBy: { number: "desc" },
    skip: (page - 1) * SALES_ORDER_PAGE_SIZE,
    take: SALES_ORDER_PAGE_SIZE,
    select: {
      id: true,
      number: true,
      status: true,
      createdAt: true,
      pricesIncludeTax: true,
      taxRate: true,
      quote: { select: { number: true } },
      customer: { select: { name: true } },
      lines: { select: { amount: true } },
    },
  });
  return {
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      quoteNumber: row.quote.number,
      customer: row.customer.name,
      status: row.status,
      statusLabel: SALES_ORDER_STATUS_LABELS[row.status],
      createdAt: row.createdAt,
      total: formatMoney(
        saleTotals(
          row.lines.map((line) => line.amount.toString()),
          {
            pricesIncludeTax: row.pricesIncludeTax,
            rate: row.taxRate.toString(),
          },
        ).total,
      ),
    })),
    total,
    page,
    pageCount,
  };
}
