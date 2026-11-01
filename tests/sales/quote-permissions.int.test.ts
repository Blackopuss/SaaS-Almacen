import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  acceptQuote,
  cancelSalesOrder,
  convertQuoteToOrder,
  createQuote,
  fulfillSalesOrder,
  getQuote,
  getSalesOrder,
  listQuotes,
  markQuoteSent,
  setSalePrices,
} from "@/modules/sales";
import { ROLE_PERMISSIONS } from "@/platform/authorization";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-10 (ADR 0030): there is no Vendedor role. The Cajero quotes, makes
// the order, delivers and charges it; cancelling is for who cancels sales;
// Consulta only reads; and from Ventas nobody adjusts stock.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("who quotes", () => {
  it("the Cajero quotes, makes the order and charges its delivery", async () => {
    const titular = await salesCompany();
    const product = await createProduct(titular, {
      sku: "P-1",
      name: "Martillo",
    });
    if (!product.ok) throw new Error("product setup failed");
    await registerEntry(titular, {
      productId: product.productId,
      quantity: "10",
      unitCost: "80",
    });
    await setSalePrices(titular, product.productId, {
      unitPrice: "150",
      presentations: {},
    });

    const cajera = await salesMember(titular.organizationId, "cashier");
    const customer = await createCustomer(cajera, { name: "Taller Sur" });
    if (!customer.ok) throw new Error("customer setup failed");
    const quote = await createQuote(cajera, {
      customerId: customer.customer.id,
      lines: [{ productId: product.productId, capture: "base", quantity: "4" }],
    });
    if (!quote.ok) throw new Error("quote failed");
    expect(await markQuoteSent(cajera, quote.quoteId)).toMatchObject({
      ok: true,
    });
    expect(await acceptQuote(cajera, quote.quoteId)).toMatchObject({
      ok: true,
    });
    const order = await convertQuoteToOrder(cajera, quote.quoteId);
    if (!order.ok) throw new Error("order failed");
    const line = await db.salesOrderLine.findFirstOrThrow({
      where: { orderId: order.orderId },
    });
    expect(
      await fulfillSalesOrder(cajera, order.orderId, {
        lines: [{ orderLineId: line.id, quantity: "2" }],
        payments: [{ method: "CASH", received: "300" }],
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: true, total: "$300.00" });
    // Cancelling is not hers; the Encargado de caja does it.
    await expect(
      cancelSalesOrder(cajera, order.orderId, "No lo quiere"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const encargado = await salesMember(titular.organizationId, "cash_manager");
    expect(
      await cancelSalesOrder(encargado, order.orderId, "No lo quiere"),
    ).toEqual({ ok: true });

    // Consulta reads quotes and orders and changes nothing.
    const consulta = await salesMember(titular.organizationId, "viewer");
    expect((await getQuote(consulta, quote.quoteId))?.number).toBe(1);
    expect((await getSalesOrder(consulta, order.orderId))?.status).toBe(
      "CANCELLED",
    );
    await expect(
      createQuote(consulta, {
        customerId: customer.customer.id,
        lines: [
          { productId: product.productId, capture: "base", quantity: "1" },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Almacén and Compras do not see Ventas.
    for (const role of ["warehouse", "buyer"] as const) {
      const other = await salesMember(titular.organizationId, role);
      await expect(listQuotes(other)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("from Ventas nobody adjusts stock: its roles only read Inventario", () => {
    for (const role of ["cashier", "cash_manager"] as const) {
      const writes = ROLE_PERMISSIONS[role].filter(
        (permission) =>
          !permission.startsWith("sales.") &&
          !permission.startsWith("platform.") &&
          !permission.endsWith(".read"),
      );
      expect(writes, role).toEqual([]);
    }
  });
});
