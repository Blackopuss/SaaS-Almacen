import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { dec, formatDateTime } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { getUnit, pluralizeName } from "@/platform/catalog";
import { forOrganization } from "@/server";

import { formatPercent } from "./discounts";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "./payments";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";
import { formatTaxRate } from "./tax";

/**
 * The ticket of a sale (VEN-15, ADR 0030): not a tax receipt (no CFDI).
 * Staff see it in the app and print it at 80 mm; the customer gets a link
 * that opens it without signing in. The link carries the company, the sale
 * and a signature: change any of them and it shows nothing.
 */

export type Ticket = {
  saleId: string;
  company: string;
  number: number;
  /** «27 oct 2026, 12:10 p.m.», in the company's time zone. */
  date: string;
  cancelled: boolean;
  /** First name of who charged it: «Ana». */
  cashier: string;
  customer: string | null;
  lines: {
    name: string;
    /** «1 caja de 500 piezas», «2.75 metros». */
    quantity: string;
    /** «$500.00 c/u». */
    unitPrice: string;
    amount: string;
  }[];
  /** «-$50.00 (10 %)»; null without a discount. */
  discount: string | null;
  /** Shown when VAT is added on top. */
  subtotal: string;
  /** «IVA incluido (16 %)» or «IVA (16 %)». */
  taxLabel: string;
  tax: string;
  total: string;
  payments: { method: string; amount: string; detail: string | null }[];
};

/** Key for signing ticket links, apart from sessions and file links. */
function ticketKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET is required to sign ticket links");
  }
  return createHmac("sha256", secret).update("almacen:sale-ticket:v1").digest();
}

const signature = (organizationId: string, saleId: string) =>
  createHmac("sha256", ticketKey())
    .update(`${organizationId}|${saleId}`)
    .digest("base64url")
    .slice(0, 32);

/** The path of a sale's public ticket: «/ticket/<company>.<sale>.<signature>». */
export function ticketPath(organizationId: string, saleId: string): string {
  return `/ticket/${organizationId}.${saleId}.${signature(organizationId, saleId)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadTicket(
  organizationId: string,
  saleId: string,
): Promise<Ticket | null> {
  const client = forOrganization(organizationId);
  const sale = await client.sale.findFirst({
    where: { id: saleId },
    select: {
      id: true,
      number: true,
      status: true,
      createdAt: true,
      soldByUserId: true,
      pricesIncludeTax: true,
      taxRate: true,
      discount: true,
      discountPercent: true,
      subtotal: true,
      tax: true,
      total: true,
      organization: { select: { name: true, timeZone: true } },
      customer: { select: { name: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          capturedQuantity: true,
          factor: true,
          unitCode: true,
          unitPrice: true,
          amount: true,
          discount: true,
          product: { select: { name: true } },
          presentation: { select: { name: true } },
        },
      },
      payments: {
        orderBy: { lineNumber: "asc" },
        select: {
          method: true,
          amount: true,
          received: true,
          changeGiven: true,
        },
      },
    },
  });
  if (!sale) return null;
  const seller = await client.membership.findFirst({
    where: { userId: sale.soldByUserId },
    select: { user: { select: { name: true } } },
  });
  const rate = formatTaxRate(sale.taxRate.toString());
  return {
    saleId: sale.id,
    company: sale.organization.name,
    number: sale.number,
    date: formatDateTime(sale.createdAt, sale.organization.timeZone),
    cancelled: sale.status === "CANCELLED",
    cashier: seller?.user.name.split(" ")[0] ?? "",
    customer: sale.customer?.name ?? null,
    lines: sale.lines.map((line) => {
      const unit = getUnit(line.unitCode);
      const captured = dec(line.capturedQuantity.toString());
      const quantity = line.presentation
        ? `${captured.toString()} ${pluralizeName(line.presentation.name, captured)} de ${dec(line.factor.toString()).toString()} ${unit.plural}`
        : `${captured.toString()} ${captured.equals(1) ? unit.name : unit.plural}`;
      return {
        name: line.product.name,
        quantity,
        unitPrice: `${formatMoney(line.unitPrice.toString())} c/u`,
        // Before the discount: the discount shows once, for the whole sale.
        amount: formatMoney(
          dec(line.amount.toString()).plus(line.discount.toString()),
        ),
      };
    }),
    discount: dec(sale.discount.toString()).isZero()
      ? null
      : `-${formatMoney(sale.discount.toString())} (${formatPercent(sale.discountPercent.toString())})`,
    subtotal: formatMoney(sale.subtotal.toString()),
    taxLabel: sale.pricesIncludeTax
      ? `IVA incluido (${rate})`
      : `IVA (${rate})`,
    tax: formatMoney(sale.tax.toString()),
    total: formatMoney(sale.total.toString()),
    payments: sale.payments.map((payment) => ({
      method: PAYMENT_METHOD_LABELS[payment.method as PaymentMethod],
      amount: formatMoney(payment.amount.toString()),
      detail:
        payment.received && payment.changeGiven && !payment.changeGiven.isZero()
          ? `Recibido ${formatMoney(payment.received.toString())} · Cambio ${formatMoney(payment.changeGiven.toString())}`
          : null,
    })),
  };
}

/** The ticket for staff, with its public link. */
export async function getSaleTicket(
  actor: SalesActor,
  saleId: string,
): Promise<(Ticket & { publicPath: string }) | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.read",
  );
  const id = String(saleId).slice(0, 36);
  if (!UUID.test(id)) return null;
  const ticket = await loadTicket(actor.organizationId, id);
  return ticket
    ? { ...ticket, publicPath: ticketPath(actor.organizationId, id) }
    : null;
}

/**
 * The ticket a customer opens from its link, without signing in. Null
 * when the link was altered or the sale does not exist.
 */
export async function getPublicTicket(token: string): Promise<Ticket | null> {
  const [organizationId = "", saleId = "", sig = ""] = String(token ?? "")
    .slice(0, 120)
    .split(".");
  if (!UUID.test(organizationId) || !UUID.test(saleId) || sig.length !== 32) {
    return null;
  }
  const expected = Buffer.from(signature(organizationId, saleId));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  return loadTicket(organizationId, saleId);
}
