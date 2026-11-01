import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import {
  reconcileStock,
  reconcileValue,
  registerEntry,
} from "@/modules/inventory";
import {
  NO_CASH_SESSION,
  SALE_KEY_REUSED,
  acceptQuote,
  cancelSalesOrder,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getOrderToFulfill,
  getSalesOrder,
  markQuoteSent,
  previewFulfillment,
  setSalePrices,
} from "@/modules/sales";
import { listAuditTrail } from "@/platform/audit";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-07 (ADR 0030): each delivery of an order is a sale of it, at the
// prices the customer accepted, with its stock exit; never more than what
// is missing, and nothing reserved: it takes what is there.

type Actor = { organizationId: string; userId: string };

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

let skus = 0;

/**
 * An order of 2 boxes of 500 ($500 each) and 3 pieces ($1.50) with 5 %
 * off, VAT included: $954.27. 600 pieces in stock.
 */
async function order(titular?: Actor) {
  const actor = titular ?? (await salesCompany());
  const product = await createProduct(actor, {
    sku: `P-${++skus}`,
    name: "Tornillo",
  });
  if (!product.ok) throw new Error("product setup failed");
  const box = await createPresentation(actor, product.productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  await registerEntry(actor, {
    productId: product.productId,
    quantity: "600",
    unitCost: "0.90",
  });
  await setSalePrices(actor, product.productId, {
    unitPrice: "1.50",
    presentations: { [box.presentationId]: "500" },
  });
  const customer = await createCustomer(actor, { name: `Obra Sur ${skus}` });
  if (!customer.ok) throw new Error("customer setup failed");
  const quote = await createQuote(actor, {
    customerId: customer.customer.id,
    discount: { percent: "5", reason: "Mayoreo" },
    lines: [
      {
        productId: product.productId,
        capture: `p:${box.presentationId}`,
        quantity: "2",
      },
      { productId: product.productId, capture: "base", quantity: "3" },
    ],
  });
  if (!quote.ok) throw new Error("quote setup failed");
  await markQuoteSent(actor, quote.quoteId);
  await acceptQuote(actor, quote.quoteId);
  const converted = await convertQuoteToOrder(actor, quote.quoteId);
  if (!converted.ok) throw new Error("order setup failed");
  const [boxLine, pieceLine] = await db.salesOrderLine.findMany({
    where: { orderId: converted.orderId },
    orderBy: { lineNumber: "asc" },
  });
  return {
    actor,
    orderId: converted.orderId,
    productId: product.productId,
    boxId: box.presentationId,
    customerId: customer.customer.id,
    boxLine: boxLine!.id,
    pieceLine: pieceLine!.id,
  };
}

const cash = (received: string) => [{ method: "CASH", received }];

describe("fulfilling an order", () => {
  it("delivers part, then the rest; each delivery is a sale at the agreed prices", async () => {
    const { actor, orderId, productId, boxId, boxLine, pieceLine } =
      await order();
    // Prices change after the order: deliveries keep the agreed ones.
    await setSalePrices(actor, productId, {
      unitPrice: "2",
      presentations: { [boxId]: "650" },
    });
    const first = await fulfillSalesOrder(actor, orderId, {
      lines: [
        { orderLineId: boxLine, quantity: "1" },
        { orderLineId: pieceLine, quantity: "3" },
      ],
      payments: cash("500"),
      idempotencyKey: newId(),
    });
    // 500 − 25 + 4.50 − 0.23.
    expect(first).toEqual({
      ok: true,
      saleId: expect.any(String),
      number: 1,
      total: "$479.27",
      charged: "$479.27",
      change: "$20.73",
      fulfilled: false,
    });
    if (!first.ok) return;
    const sale = await db.sale.findUniqueOrThrow({
      where: { id: first.saleId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(sale).toMatchObject({
      salesOrderId: orderId,
      discountReason: "Mayoreo",
    });
    expect(
      sale.lines.map((line) => [
        line.orderLineId,
        line.baseQuantity.toString(),
        line.unitPrice.toString(),
        line.amount.toString(),
      ]),
    ).toEqual([
      [boxLine, "500", "500", "475"],
      [pieceLine, "3", "1.5", "4.27"],
    ]);

    let view = await getSalesOrder(actor, orderId);
    expect(view).toMatchObject({ status: "PARTIAL" });
    expect(
      view!.lines.map((line) => [line.deliveredText, line.missingText]),
    ).toEqual([
      ["1 caja de 500 piezas", "1 caja de 500 piezas"],
      ["3 piezas", null],
    ]);

    // Never more than what is missing.
    expect(
      await fulfillSalesOrder(actor, orderId, {
        lines: [
          { orderLineId: boxLine, quantity: "2" },
          { orderLineId: pieceLine, quantity: "1" },
        ],
        payments: cash("2000"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      lineErrors: {
        [boxLine]: "Solo falta 1 caja de 500 piezas.",
        [pieceLine]: "De esta línea ya se entregó todo.",
      },
    });
    // Nothing reserved: 97 pieces are left, not a box.
    expect(
      await fulfillSalesOrder(actor, orderId, {
        lines: [{ orderLineId: boxLine, quantity: "1" }],
        payments: cash("500"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      lineErrors: { [boxLine]: expect.stringMatching(/Solo hay 97 piezas/) },
    });

    await registerEntry(actor, {
      productId,
      quantity: "500",
      unitCost: "0.90",
    });
    const second = await fulfillSalesOrder(actor, orderId, {
      lines: [{ orderLineId: boxLine, quantity: "1" }],
      payments: [{ method: "CARD", reference: "4821" }],
      idempotencyKey: newId(),
    });
    expect(second).toMatchObject({
      ok: true,
      number: 2,
      total: "$475.00",
      fulfilled: true,
    });
    view = await getSalesOrder(actor, orderId);
    // Delivered whole, it adds up to what was agreed.
    expect(view).toMatchObject({ status: "FULFILLED", total: "$954.27" });
    expect(view!.sales.map((s) => [s.number, s.total])).toEqual([
      [1, "$479.27"],
      [2, "$475.00"],
    ]);
    expect(
      await fulfillSalesOrder(actor, orderId, {
        lines: [{ orderLineId: boxLine, quantity: "1" }],
        payments: cash("500"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      formError: "Este pedido ya se surtió completo.",
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
    expect(await reconcileValue(actor.organizationId)).toEqual([]);
  });

  it("charges exactly: payments must add up to what is delivered", async () => {
    const { actor, orderId, pieceLine } = await order();
    expect(
      await fulfillSalesOrder(actor, orderId, {
        lines: [{ orderLineId: pieceLine, quantity: "3" }],
        payments: [
          { method: "CASH", amount: "1", received: "1" },
          { method: "CARD", amount: "1", reference: "1" },
        ],
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, formError: expect.stringMatching(/\$4\.27/) });
    expect(
      await fulfillSalesOrder(actor, orderId, {
        lines: [{ orderLineId: pieceLine, quantity: "0" }],
        payments: cash("10"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({
      ok: false,
      formError: "Escribe cuánto entregas de al menos un producto.",
    });
    expect(
      await db.sale.count({ where: { organizationId: actor.organizationId } }),
    ).toBe(0);
  });

  it("once: a retry answers with the same sale, two at once never deliver twice", async () => {
    const { actor, orderId, productId, boxLine, pieceLine } = await order();
    const all = [
      { orderLineId: boxLine, quantity: "1" },
      { orderLineId: pieceLine, quantity: "3" },
    ];
    const key = newId();
    const first = await fulfillSalesOrder(actor, orderId, {
      lines: all,
      payments: cash("500"),
      idempotencyKey: key,
    });
    expect(
      await fulfillSalesOrder(actor, orderId, {
        lines: all,
        payments: cash("500"),
        idempotencyKey: key,
      }),
    ).toEqual({ ...first, repeated: true });
    expect(
      await fulfillSalesOrder(actor, orderId, {
        lines: [{ orderLineId: boxLine, quantity: "1" }],
        payments: cash("500"),
        idempotencyKey: key,
      }),
    ).toMatchObject({ ok: false, formError: SALE_KEY_REUSED });

    await registerEntry(actor, {
      productId,
      quantity: "1000",
      unitCost: "0.90",
    });
    const cajera = await salesMember(actor.organizationId, "cashier");
    const results = await Promise.all(
      [actor, cajera].map((who) =>
        fulfillSalesOrder(who, orderId, {
          lines: [{ orderLineId: boxLine, quantity: "1" }],
          payments: cash("500"),
          idempotencyKey: newId(),
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      formError: "Este pedido ya se surtió completo.",
    });
    expect(await db.saleLine.count({ where: { orderLineId: boxLine } })).toBe(
      2,
    );
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("who may: who charges, with their register open; nobody of another company", async () => {
    const { actor, orderId, pieceLine } = await order();
    const line = [{ orderLineId: pieceLine, quantity: "1" }];
    const consulta = await salesMember(actor.organizationId, "viewer");
    await expect(
      fulfillSalesOrder(consulta, orderId, {
        lines: line,
        payments: cash("5"),
        idempotencyKey: newId(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const closed = await salesMember(actor.organizationId, "cashier", {
      openCash: false,
    });
    expect(
      await fulfillSalesOrder(closed, orderId, {
        lines: line,
        payments: cash("5"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, formError: NO_CASH_SESSION });
    const other = await salesCompany();
    expect(
      await fulfillSalesOrder(other, orderId, {
        lines: line,
        payments: cash("5"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    const cajera = await salesMember(actor.organizationId, "cashier");
    expect(
      await fulfillSalesOrder(cajera, orderId, {
        lines: line,
        payments: cash("5"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: true, total: "$1.42" });
  });

  it("the database keeps a delivery in the terms of its order", async () => {
    const first = await order();
    const second = await order(first.actor);
    const done = await fulfillSalesOrder(first.actor, first.orderId, {
      lines: [{ orderLineId: first.pieceLine, quantity: "1" }],
      payments: cash("5"),
      idempotencyKey: newId(),
    });
    if (!done.ok) throw new Error("delivery failed");
    const line = await db.saleLine.findFirstOrThrow({
      where: { saleId: done.saleId },
    });
    // A line of another order, or another price, is refused.
    await expect(
      db.saleLine.create({
        data: {
          ...line,
          id: newId(),
          lineNumber: 2,
          orderLineId: second.pieceLine,
        },
      }),
    ).rejects.toThrow(/not a line of the order/);
    await expect(
      db.saleLine.create({
        data: {
          ...line,
          id: newId(),
          lineNumber: 2,
          unitPrice: "1",
          discount: "0",
          amount: "1",
        },
      }),
    ).rejects.toThrow(/not a line of the order/);
    await expect(
      db.sale.update({
        where: { id: done.saleId },
        data: { salesOrderId: second.orderId },
      }),
    ).rejects.toThrow(/only a completed sale can be cancelled/);
    await expect(
      db.salesOrder.update({
        where: { id: first.orderId },
        data: { status: "CANCELLED" },
      }),
    ).rejects.toThrow(/sales_order_cancel_check/);
    await cancelSalesOrder(first.actor, first.orderId, "Ya no lo quiere");
    await expect(
      db.salesOrder.update({
        where: { id: first.orderId },
        data: { status: "OPEN" },
      }),
    ).rejects.toThrow(/status change is not allowed/);
  });

  it("the screen: what is missing, what fits now and what it adds up to (COT-08)", async () => {
    const { actor, orderId, boxLine, pieceLine } = await order();
    // 600 pieces: one box fits, not two.
    let view = await getOrderToFulfill(actor, orderId);
    expect(view).toMatchObject({ number: 1, closed: null });
    expect(
      view!.lines.map((line) => [
        line.missingText,
        line.unitLabel,
        line.suggested,
        line.locations.length,
      ]),
    ).toEqual([
      ["2 cajas de 500 piezas", "cajas de 500 piezas", "1", 1],
      ["3 piezas", "piezas", "3", 1],
    ]);
    const lines = [
      { orderLineId: boxLine, quantity: "1" },
      { orderLineId: pieceLine, quantity: "3" },
    ];
    const preview = await previewFulfillment(actor, orderId, {
      lines,
      payments: cash("500"),
    });
    expect(preview).toMatchObject({
      lines: {
        [boxLine]: { amount: "$475.00" },
        [pieceLine]: { amount: "$4.27" },
      },
      lineErrors: {},
      total: "$479.27",
      paymentNote: "Cambio: $20.73",
    });
    // Two boxes do not fit: it says so before charging.
    expect(
      (
        await previewFulfillment(actor, orderId, {
          lines: [{ orderLineId: boxLine, quantity: "2" }],
        })
      )?.lines[boxLine],
    ).toEqual({ amount: "$950.00", error: "Ahí solo hay 600 piezas." });
    const done = await fulfillSalesOrder(actor, orderId, {
      lines,
      payments: cash("500"),
      idempotencyKey: newId(),
    });
    expect(done).toMatchObject({ ok: true, total: preview!.total });
    // Only what is missing; nothing fits now.
    view = await getOrderToFulfill(actor, orderId);
    expect(
      view!.lines.map((line) => [line.id, line.missingText, line.suggested]),
    ).toEqual([[boxLine, "1 caja de 500 piezas", "0"]]);
    expect(await getOrderToFulfill(await salesCompany(), orderId)).toBeNull();
    const consulta = await salesMember(actor.organizationId, "viewer");
    await expect(getOrderToFulfill(consulta, orderId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("cancelling an order (COT-09)", () => {
  it("closes what is missing; what was delivered stays sold", async () => {
    const { actor, orderId, boxLine, pieceLine } = await order();
    await fulfillSalesOrder(actor, orderId, {
      lines: [{ orderLineId: pieceLine, quantity: "3" }],
      payments: cash("5"),
      idempotencyKey: newId(),
    });
    expect(await cancelSalesOrder(actor, orderId, "")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await cancelSalesOrder(actor, orderId, "Ya no lo necesita")).toEqual(
      { ok: true },
    );
    expect(await cancelSalesOrder(actor, orderId, "Otra vez")).toEqual({
      ok: true,
      repeated: true,
    });
    const view = await getSalesOrder(actor, orderId);
    expect(view).toMatchObject({
      status: "CANCELLED",
      statusLabel: "Cancelado",
      cancellation: { reason: "Ya no lo necesita" },
    });
    expect(view!.sales).toHaveLength(1);
    expect(
      await fulfillSalesOrder(actor, orderId, {
        lines: [{ orderLineId: boxLine, quantity: "1" }],
        payments: cash("500"),
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, formError: "Este pedido está cancelado." });
    const trail = await listAuditTrail(actor.organizationId, { limit: 10 });
    expect(trail.map((entry) => entry.action)).toContain(
      "sales.order_cancelled",
    );
    // The cancellation does not change afterwards.
    await expect(
      db.salesOrder.update({
        where: { id: orderId },
        data: { cancelReason: "Otro motivo" },
      }),
    ).rejects.toThrow(/cancellation cannot change/);
  });

  it("a fulfilled order has nothing to cancel; only who cancels sales may", async () => {
    const { actor, orderId, productId, boxLine, pieceLine } = await order();
    const cajera = await salesMember(actor.organizationId, "cashier");
    await expect(
      cancelSalesOrder(cajera, orderId, "No lo quiere"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await cancelSalesOrder(await salesCompany(), orderId, "No lo quiere"),
    ).toMatchObject({ ok: false, reason: "not_found" });
    await registerEntry(actor, {
      productId,
      quantity: "1000",
      unitCost: "0.90",
    });
    await fulfillSalesOrder(actor, orderId, {
      lines: [
        { orderLineId: boxLine, quantity: "2" },
        { orderLineId: pieceLine, quantity: "3" },
      ],
      payments: cash("1000"),
      idempotencyKey: newId(),
    });
    const encargada = await salesMember(actor.organizationId, "cash_manager");
    expect(
      await cancelSalesOrder(encargada, orderId, "No lo quiere"),
    ).toMatchObject({ ok: false, reason: "invalid_state" });
  });
});
