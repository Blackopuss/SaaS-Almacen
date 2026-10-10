import "server-only";

import { formatDate } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { PDF_PAGE, PdfPageWriter, buildPdf, wrapText } from "@/platform/files";
import { forOrganization } from "@/server";

import { getPurchaseOrder, type PurchaseOrderDetail } from "./orders";
import type { PurchasingActor } from "./product-suppliers";

/**
 * The purchase order as a PDF (CMP-06A): the document handed or sent to
 * the supplier, with the data of the business and of the supplier, what
 * is asked for — with its conversion — and its prices.
 *
 * It carries prices, so it is for who may export orders
 * (`purchasing.order.export`: not Consulta) and, like the screen, shows
 * costs only to who may see them. A draft or a cancelled order says so
 * across its top: a paper that leaves the business must not pass for an
 * order that was placed.
 */

const MARGIN = 48;
const RIGHT = PDF_PAGE.width - MARGIN;
const BOTTOM = PDF_PAGE.height - 72;

/** Where the block with the dates of the order starts. */
const DETAILS = MARGIN + 320;

/** Where each column of the table starts (or ends, for amounts). */
const COLUMN = {
  number: MARGIN,
  code: MARGIN + 18,
  description: MARGIN + 96,
  quantity: MARGIN + 252,
  cost: RIGHT - 70,
  amount: RIGHT,
} as const;

export type OrderPdf = { name: string; contentType: string; bytes: Buffer };

type Supplier = {
  name: string;
  legalName: string | null;
  rfc: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
};

const day = (value: string) =>
  formatDate(new Date(`${value}T12:00:00.000Z`), "UTC");

function draw(
  order: PurchaseOrderDetail,
  supplier: Supplier,
  company: { name: string; timeZone: string },
): PdfPageWriter[] {
  const pages: PdfPageWriter[] = [];
  let page = new PdfPageWriter();
  let y = 0;
  const costs = order.costsVisible;
  // Without prices the description and the quantity take their room.
  const quantityX = costs ? COLUMN.quantity : COLUMN.quantity + 60;
  const descriptionWidth = quantityX - COLUMN.description - 10;
  const quantityWidth = (costs ? COLUMN.cost - 62 : RIGHT) - quantityX;

  const tableHeader = () => {
    page.box(MARGIN, y - 10, RIGHT - MARGIN, 16, 0.92);
    const head = { size: 8, font: "bold" as const };
    page.text(COLUMN.number + 2, y, "#", head);
    page.text(COLUMN.code, y, "Código", head);
    page.text(COLUMN.description, y, "Producto", head);
    page.text(quantityX, y, "Cantidad", head);
    if (costs) {
      page.text(COLUMN.cost, y, "Costo", { ...head, align: "right" });
      page.text(COLUMN.amount - 2, y, "Importe", { ...head, align: "right" });
    }
    y += 18;
  };

  const startPage = (first: boolean) => {
    page = new PdfPageWriter();
    pages.push(page);
    page.text(MARGIN, 56, company.name, { size: 15, font: "bold" });
    page.text(RIGHT, 52, "ORDEN DE COMPRA", {
      size: 12,
      font: "bold",
      align: "right",
    });
    page.text(RIGHT, 68, order.numberText, { size: 12, align: "right" });
    if (order.status === "DRAFT" || order.status === "CANCELLED") {
      page.text(
        RIGHT,
        82,
        order.status === "DRAFT"
          ? "BORRADOR · todavía no es un pedido"
          : "CANCELADA",
        { size: 9, font: "bold", align: "right", gray: 0.35 },
      );
    }
    page.line(MARGIN, 92, RIGHT, 92, { width: 1 });
    y = 112;
    if (!first) {
      page.text(MARGIN, y, "Continuación", { size: 9, gray: 0.35 });
      y += 20;
      tableHeader();
    }
  };

  startPage(true);

  // Who it is for, and its dates.
  const label = { size: 8, gray: 0.35 } as const;
  page.text(MARGIN, y, "PROVEEDOR", label);
  page.text(DETAILS, y, "DATOS DE LA ORDEN", label);
  const top = y + 14;
  let left = top;
  for (const [index, line] of wrapText(
    supplier.name,
    300,
    11,
    "bold",
  ).entries()) {
    if (index < 2) {
      page.text(MARGIN, left, line, { size: 11, font: "bold" });
      left += 14;
    }
  }
  for (const text of [
    supplier.legalName,
    supplier.rfc ? `RFC ${supplier.rfc}` : null,
    supplier.contactPerson ? `Atención: ${supplier.contactPerson}` : null,
    supplier.phone ? `Tel. ${supplier.phone}` : null,
    supplier.email,
    supplier.address,
  ]) {
    if (!text) continue;
    for (const line of wrapText(text, 300, 9, "regular").slice(0, 2)) {
      page.text(MARGIN, left, line, { size: 9 });
      left += 12;
    }
  }
  let right = top;
  for (const [name, value] of [
    ["Fecha", formatDate(order.createdAt, company.timeZone)],
    [
      "Confirmada",
      order.sentAt ? formatDate(order.sentAt, company.timeZone) : null,
    ],
    ["Se espera", order.expectedOn ? day(order.expectedOn) : null],
    ["Estado", order.statusLabel],
  ] as const) {
    if (!value) continue;
    page.text(DETAILS, right, `${name}:`, { size: 9, gray: 0.35 });
    page.text(DETAILS + 60, right, value, { size: 9 });
    right += 12;
  }
  y = Math.max(left, right) + 16;

  tableHeader();
  for (const line of order.lines) {
    const name = wrapText(line.productName, descriptionWidth, 9, "regular");
    const quantity = wrapText(line.quantityText, quantityWidth, 9, "regular");
    const code = wrapText(
      line.supplierSku ?? line.sku,
      COLUMN.description - COLUMN.code - 8,
      9,
      "regular",
    );
    const rows = Math.max(name.length, quantity.length, code.length);
    const height = rows * 11 + 7;
    if (y + height > BOTTOM) startPage(false);
    const text = { size: 9 } as const;
    page.text(COLUMN.number + 2, y, String(line.lineNumber), text);
    code.forEach((part, index) =>
      page.text(COLUMN.code, y + index * 11, part, text),
    );
    name.forEach((part, index) =>
      page.text(COLUMN.description, y + index * 11, part, text),
    );
    quantity.forEach((part, index) =>
      page.text(quantityX, y + index * 11, part, text),
    );
    if (costs) {
      page.text(
        COLUMN.cost,
        y,
        line.unitCost ? `$${money(line.unitCost)}` : "—",
        { ...text, align: "right" },
      );
      page.text(COLUMN.amount - 2, y, line.amountText ?? "—", {
        ...text,
        align: "right",
      });
    }
    y += height;
    page.line(MARGIN, y - 9, RIGHT, y - 9, { width: 0.3, gray: 0.75 });
  }
  if (order.lines.length === 0) {
    page.text(MARGIN, y, "Esta orden no tiene productos.", {
      size: 9,
      gray: 0.35,
    });
    y += 16;
  }

  if (costs && order.lines.length > 0) {
    if (y + 40 > BOTTOM) startPage(false);
    y += 6;
    page.text(COLUMN.cost, y, "Total antes de impuestos", {
      size: 10,
      font: "bold",
      align: "right",
    });
    page.text(COLUMN.amount - 2, y, order.totalText ?? "—", {
      size: 10,
      font: "bold",
      align: "right",
    });
    y += 14;
    if ((order.linesWithoutCost ?? 0) > 0) {
      page.text(
        COLUMN.amount - 2,
        y,
        order.linesWithoutCost === 1
          ? "No incluye 1 producto sin costo."
          : `No incluye ${order.linesWithoutCost} productos sin costo.`,
        { size: 8, align: "right", gray: 0.35 },
      );
      y += 12;
    }
  }

  if (order.notes) {
    const notes = wrapText(order.notes, RIGHT - MARGIN, 9, "regular");
    if (y + 30 + notes.length * 12 > BOTTOM) startPage(false);
    y += 14;
    page.text(MARGIN, y, "NOTAS", label);
    y += 13;
    for (const line of notes) {
      if (y > BOTTOM) startPage(false);
      page.text(MARGIN, y, line, { size: 9 });
      y += 12;
    }
  }
  if (order.status === "CANCELLED" && order.cancelReason) {
    const reason = wrapText(order.cancelReason, RIGHT - MARGIN, 9, "regular");
    if (y + 30 + reason.length * 12 > BOTTOM) startPage(false);
    y += 14;
    page.text(MARGIN, y, "MOTIVO DE LA CANCELACIÓN", label);
    y += 13;
    for (const line of reason) {
      page.text(MARGIN, y, line, { size: 9 });
      y += 12;
    }
  }

  // The foot of every page, once the number of pages is known.
  pages.forEach((sheet, index) => {
    sheet.line(MARGIN, PDF_PAGE.height - 52, RIGHT, PDF_PAGE.height - 52, {
      width: 0.3,
      gray: 0.75,
    });
    sheet.text(
      MARGIN,
      PDF_PAGE.height - 38,
      `${order.numberText} · ${company.name}`,
      { size: 8, gray: 0.35 },
    );
    sheet.text(
      RIGHT,
      PDF_PAGE.height - 38,
      `Página ${index + 1} de ${pages.length}`,
      { size: 8, align: "right", gray: 0.35 },
    );
  });
  return pages;
}

/** «1,250.50», from an exact amount as text; display only. */
function money(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction.padEnd(2, "0")}`;
}

/**
 * Builds the PDF of an order of the company; null when it is not one of
 * its orders. Each download is written down in the audit trail.
 */
export async function buildOrderPdf(
  actor: PurchasingActor,
  orderId: string,
): Promise<OrderPdf | null> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.order.export",
  );
  // Reads the order as the screen does: same permission, and costs only
  // for who may see them.
  const order = await getPurchaseOrder(actor, orderId);
  if (!order) return null;
  const client = forOrganization(organizationId);
  const [supplier, membership] = await Promise.all([
    client.contact.findFirst({
      where: { id: order.supplierId },
      select: {
        name: true,
        legalName: true,
        rfc: true,
        contactPerson: true,
        phone: true,
        email: true,
        address: true,
      },
    }),
    client.membership.findFirst({
      select: { organization: { select: { name: true, timeZone: true } } },
    }),
  ]);
  if (!supplier || !membership) return null;
  const bytes = buildPdf(draw(order, supplier, membership.organization), {
    title: `Orden de compra ${order.numberText}`,
  });
  await recordAuditEvent(client, {
    organizationId,
    actorUserId: userId,
    action: "purchase_order.exported",
    target: { type: "purchase_order", id: order.id },
    metadata: { orden: order.numberText, proveedor: supplier.name },
  });
  return {
    name: `${order.numberText}.pdf`,
    contentType: "application/pdf",
    bytes,
  };
}
