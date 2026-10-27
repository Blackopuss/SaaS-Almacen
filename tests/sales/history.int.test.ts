import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  cancelSale,
  listSaleCashiers,
  listSales,
  registerSale,
  returnSale,
  setSalePrices,
  type SaleInput,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-22 (ADR 0030): the history of sales, newest first, filtered by days
// of the company's calendar, who charged and the customer or the number.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

type Actor = { organizationId: string; userId: string };

async function store() {
  const titular = await salesCompany();
  const created = await createProduct(titular, { sku: "H-1", name: "Clavo" });
  if (!created.ok) throw new Error("product setup failed");
  const productId = created.productId;
  await registerEntry(titular, { productId, quantity: "100" });
  await setSalePrices(titular, productId, {
    unitPrice: "1.50",
    presentations: {},
  });
  const cajero = await salesMember(titular.organizationId, "cashier");
  const juan = await createCustomer(titular, { name: "Juan Pérez" });
  const maria = await createCustomer(titular, { name: "María López" });
  if (!juan.ok || !maria.ok) throw new Error("customer setup failed");

  const sell = async (
    who: Actor,
    quantity: string,
    extra: Partial<SaleInput> = {},
  ) => {
    const result = await registerSale(who, {
      lines: [{ productId, capture: "base", quantity }],
      payments: [{ method: "CASH" }],
      idempotencyKey: newId(),
      ...extra,
    });
    if (!result.ok) throw new Error("sale failed");
    return result.saleId;
  };
  // 1: public, by the owner; 2: Juan, by the cashier, cash and card;
  // 3: María, by the owner, cancelled later.
  const first = await sell(titular, "4");
  await sell(cajero, "2", {
    customerId: juan.customer.id,
    payments: [
      { method: "CASH", amount: "1" },
      { method: "CARD", amount: "2", reference: "77" },
    ],
  });
  const third = await sell(titular, "3", { customerId: maria.customer.id });
  const line = await db.saleLine.findFirstOrThrow({
    where: { saleId: first },
  });
  await returnSale(titular, first, {
    lines: [{ saleLineId: line.id, quantity: "1" }],
    reason: "Sobró",
    refundMethod: "CASH",
    idempotencyKey: newId(),
  });
  await cancelSale(titular, third, {
    reason: "Error",
    refundMethod: "CASH",
    idempotencyKey: newId(),
  });
  return { titular, cajero };
}

describe("history of sales", () => {
  it("newest first, with customer, who charged, how and what came back", async () => {
    const { titular } = await store();
    const page = await listSales(titular);
    expect(page.total).toBe(3);
    expect(
      page.items.map((sale) => [
        sale.number,
        sale.customer,
        sale.total,
        sale.paidWith,
        sale.cancelled,
        sale.refunded,
      ]),
    ).toEqual([
      [3, "María López", "$4.50", "Efectivo", true, null],
      [2, "Juan Pérez", "$3.00", "Efectivo y tarjeta", false, null],
      [1, "Público en general", "$6.00", "Efectivo", false, "$1.50"],
    ]);
    expect(page.items[1]!.cashier).toMatch(/^cashier/);
  });

  it("filters by who charged, customer, number and days", async () => {
    const { titular, cajero } = await store();
    const numbers = async (filters: Parameters<typeof listSales>[1]) =>
      (await listSales(titular, filters)).items.map((sale) => sale.number);

    expect(await numbers({ cashierId: cajero.userId })).toEqual([2]);
    expect(await numbers({ cashierId: titular.userId })).toEqual([3, 1]);
    expect(await numbers({ search: "pérez juan" })).toEqual([2]);
    expect(await numbers({ search: "  maría " })).toEqual([3]);
    expect(await numbers({ search: "2" })).toEqual([2]);
    expect(await numbers({ search: "%" })).toEqual([]);
    expect(await numbers({ from: "2000-01-01", to: "2999-12-31" })).toEqual([
      3, 2, 1,
    ]);
    expect(await numbers({ from: "2999-01-01" })).toEqual([]);
    expect(await numbers({ to: "2000-01-01" })).toEqual([]);

    const odd = await listSales(titular, { from: "mañana", page: 99 });
    expect(odd.applied.from).toBeNull();
    expect(odd.page).toBe(1);

    expect(
      (await listSaleCashiers(titular)).map((c) => c.userId).sort(),
    ).toEqual([titular.userId, cajero.userId].sort());
  });

  it("only with sales.sale.read, and only the company's own", async () => {
    const { titular } = await store();
    const consulta = await salesMember(titular.organizationId, "viewer");
    expect((await listSales(consulta)).total).toBe(3);
    const almacen = await salesMember(titular.organizationId, "warehouse");
    await expect(listSales(almacen)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listSaleCashiers(almacen)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const other = await salesCompany();
    expect((await listSales(other)).total).toBe(0);
    expect((await listSales(other, { cashierId: titular.userId })).total).toBe(
      0,
    );
  });
});
