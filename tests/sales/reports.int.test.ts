import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  buildSalesReport,
  cancelSale,
  getSalesReport,
  registerSale,
  returnSale,
  setSalePrices,
} from "@/modules/sales";
import { listAuditTrail } from "@/platform/audit";
import { createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-23 (ADR 0030): what was sold in a period by day, product and who
// charged, with cancellations and returns taken off; the profit only for
// who may see inventory costs, in the screen and in the files.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

type Actor = { organizationId: string; userId: string };

async function product(
  actor: Actor,
  sku: string,
  price: string,
  cost: string,
  stock: string,
) {
  const created = await createProduct(actor, { sku, name: `Producto ${sku}` });
  if (!created.ok) throw new Error("product setup failed");
  await registerEntry(actor, {
    productId: created.productId,
    quantity: stock,
    unitCost: cost,
  });
  await setSalePrices(actor, created.productId, {
    unitPrice: price,
    presentations: {},
  });
  return created.productId;
}

async function store() {
  const titular = await salesCompany();
  const a = await product(titular, "A", "1.50", "0.90", "1000");
  const b = await product(titular, "B", "10", "6", "100");
  const cajero = await salesMember(titular.organizationId, "cashier");
  const sell = async (
    who: Actor,
    lines: [string, string][],
    payments: { method: string; reference?: string }[] = [{ method: "CASH" }],
  ) => {
    const result = await registerSale(who, {
      lines: lines.map(([productId, quantity]) => ({
        productId,
        capture: "base",
        quantity,
      })),
      payments,
      idempotencyKey: newId(),
    });
    if (!result.ok) throw new Error("sale failed");
    return result.saleId;
  };
  // $15.00 · $20.00 by the cashier · $16.00 with 2 of A back · cancelled.
  await sell(titular, [[a, "10"]]);
  await sell(cajero, [[b, "2"]], [{ method: "CARD", reference: "55" }]);
  const third = await sell(titular, [
    [a, "4"],
    [b, "1"],
  ]);
  const fourth = await sell(titular, [[b, "1"]]);
  const lineOfA = await db.saleLine.findFirstOrThrow({
    where: { saleId: third, productId: a },
  });
  const back = await returnSale(titular, third, {
    lines: [{ saleLineId: lineOfA.id, quantity: "2" }],
    reason: "Sobró",
    refundMethod: "CASH",
    idempotencyKey: newId(),
  });
  const cancel = await cancelSale(titular, fourth, {
    reason: "Error",
    refundMethod: "CASH",
    idempotencyKey: newId(),
  });
  if (!back.ok || !cancel.ok) throw new Error("return setup failed");
  return { titular, cajero };
}

describe("sales report", () => {
  it("by day, product and who charged, without cancellations and with returns off", async () => {
    const { titular, cajero } = await store();
    const report = await getSalesReport(titular);
    if (!report.ok) throw new Error(report.error);
    // VAT included at 16 %: profit = amount / 1.16 − units × cost.
    expect(report).toMatchObject({
      costsVisible: true,
      sales: 3,
      total: { amount: "48.00", text: "$48.00" },
      profit: { amount: "12.58" },
      linesWithoutCost: 0,
      truncated: false,
    });
    expect(report.byDay).toHaveLength(1);
    expect(report.byDay[0]).toMatchObject({
      sales: 3,
      total: { amount: "48.00" },
    });
    expect(
      report.byProduct.map((row) => [
        row.sku,
        row.baseQuantity,
        row.quantity,
        row.sales,
        row.total.amount,
        row.profit?.amount,
      ]),
    ).toEqual([
      ["B", "3", "3 piezas", 2, "30.00", "7.86"],
      ["A", "12", "12 piezas", 2, "18.00", "4.72"],
    ]);
    expect(
      report.byCashier.map((row) => [
        row.key,
        row.sales,
        row.total.amount,
        row.profit?.amount,
      ]),
    ).toEqual([
      [titular.userId, 2, "28.00", "7.34"],
      [cajero.userId, 1, "20.00", "5.24"],
    ]);
  });

  it("a product without a known cost shows no profit, and the total says so", async () => {
    const titular = await salesCompany();
    const created = await createProduct(titular, {
      sku: "S",
      name: "Sin costo",
    });
    if (!created.ok) throw new Error("product setup failed");
    await registerEntry(titular, {
      productId: created.productId,
      quantity: "9",
    });
    await setSalePrices(titular, created.productId, {
      unitPrice: "5",
      presentations: {},
    });
    const sold = await registerSale(titular, {
      lines: [{ productId: created.productId, capture: "base", quantity: "2" }],
      payments: [{ method: "CASH" }],
      idempotencyKey: newId(),
    });
    expect(sold.ok).toBe(true);
    const report = await getSalesReport(titular);
    if (!report.ok) throw new Error(report.error);
    expect(report).toMatchObject({
      linesWithoutCost: 1,
      total: { amount: "10.00" },
    });
    expect(report.byProduct[0]).toMatchObject({ costUnknown: true });
    expect("profit" in report.byProduct[0]!).toBe(false);
  });

  it("dates are days of the company's calendar; bad ones are refused", async () => {
    const { titular } = await store();
    expect(
      await getSalesReport(titular, { from: "2999-01-01", to: "2999-01-31" }),
    ).toMatchObject({ ok: true, sales: 0, byDay: [] });
    expect(
      await getSalesReport(titular, { from: "2000-01-01", to: "2999-12-31" }),
    ).toMatchObject({ ok: true, sales: 3 });
    expect(await getSalesReport(titular, { from: "ayer" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/día de calendario/),
    });
    expect(
      await getSalesReport(titular, { from: "2026-10-10", to: "2026-10-01" }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/anterior/) });
  });

  it("the profit only for who may see costs, also in the file", async () => {
    const { titular } = await store();
    const consulta = await salesMember(titular.organizationId, "viewer");
    const report = await getSalesReport(consulta);
    if (!report.ok) throw new Error(report.error);
    expect(report.costsVisible).toBe(false);
    expect("profit" in report).toBe(false);
    expect(report.byProduct.every((row) => !("profit" in row))).toBe(true);

    const file = await buildSalesReport(consulta, {
      kind: "productos",
      format: "csv",
    });
    if (!file.ok) throw new Error(file.error);
    const text = file.bytes.toString("utf8");
    expect(text).toMatch(/Total con IVA/);
    expect(text).not.toMatch(/Ganancia/);
    expect(file.rows).toBe(2);
    expect(file.name).toMatch(/^ventas-productos-\d{4}-\d{2}-\d{2}-a-/);

    const owners = await buildSalesReport(titular, {
      kind: "dias",
      format: "csv",
    });
    if (!owners.ok) throw new Error(owners.error);
    expect(owners.bytes.toString("utf8")).toMatch(/Ganancia antes de IVA/);
    const trail = await listAuditTrail(titular.organizationId, { limit: 10 });
    expect(trail.map((entry) => entry.action)).toContain(
      "sales.report_exported",
    );
  });

  it("a cashier does not see reports; another company sees none of these", async () => {
    const { titular, cajero } = await store();
    await expect(getSalesReport(cajero)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      buildSalesReport(cajero, { kind: "dias", format: "xlsx" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await salesCompany();
    expect(await getSalesReport(other)).toMatchObject({ ok: true, sales: 0 });
    expect(titular.organizationId).not.toBe(other.organizationId);
  });
});
