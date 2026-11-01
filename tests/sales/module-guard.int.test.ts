import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import { moduleOpenWork } from "@/modules/registry";
import * as sales from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany } from "../setup/sales";

// VEN-26 (ADR 0030): without Ventas nothing of it works, whoever calls it;
// with Ventas ended (read-only) its history is consulted and exported but
// nothing is written; and before taking it away the console is told what
// is left halfway. A service added later without its guard fails here.

/**
 * Exported functions that are not services a person calls: pure helpers,
 * the worker's work (it checks the company and who asked by itself), the
 * customer's signed ticket link, and what the platform console asks.
 */
const NOT_SERVICES = new Set([
  "addMonths",
  "applyPayments",
  "awaitsFulfillment",
  "canQuoteTransition",
  "canSalesOrderTransition",
  "describeTerms",
  "effectivePrice",
  "formatDueDay",
  "formatMoney",
  "formatPercent",
  "formatTaxRate",
  "isSalesReportKind",
  "parsePercent",
  "parsePrice",
  "parseTaxRate",
  "paymentNote",
  "planInstallments",
  "quoteTransitionProblem",
  "readPayments",
  "saleTotals",
  "setSalesClock",
  "ticketPath",
  // A day of the calendar, nothing of the company's data.
  "defaultQuoteValidity",
  // Inside other services' transactions or the worker's.
  "readOverdueReminders",
  "deliverQuote",
  "deliverStatement",
  "scheduleOverdueReminders",
  // The customer's ticket, by its signed link, with no session (VEN-15).
  "getPublicTicket",
  // Asked by the platform console (staff only) before removing the module.
  "salesOpenWork",
]);

type Service = (...args: unknown[]) => Promise<unknown>;
const services = Object.entries(sales).filter(
  ([name, value]) => typeof value === "function" && !NOT_SERVICES.has(name),
) as [string, Service][];

/**
 * Services that only read or export: they go on with the module ended. The
 * ones that serve charging (the counter's search and preview, checks of a
 * lost answer, the open registers) stop with it, like charging.
 */
const READS = new Set([
  "buildQuotePdf",
  "buildSalesReport",
  "buildStatementPdf",
  "composeQuotePdf",
  "countSalesBetween",
  "findReturnByKey",
  "getAccountReminders",
  "getCashSession",
  "getCustomerStatement",
  "getInstallmentTerms",
  "getPortfolioReport",
  "getQuote",
  "getQuoteDeliveries",
  "getQuoteReport",
  "getReceivable",
  "getReceivableOfSale",
  "getReceivablePayment",
  "getReturnableSale",
  "getSalePrices",
  "getSaleTicket",
  "getSalesOrder",
  "getSalesReport",
  "getStatementDeliveries",
  "listQuotes",
  "listReceivables",
  "listSaleCashiers",
  "listSales",
  "listSalesOrders",
]);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

const call = (service: Service, actor: unknown) =>
  service(actor, newId(), {}, newId()).then(
    () => "answered",
    (error: { code?: string }) => error.code ?? "error",
  );

async function withoutSales(organizationId: string) {
  await db.entitlement.deleteMany({
    where: { organizationId, kind: "MODULE", key: "sales" },
  });
  invalidateEntitlements(organizationId);
}

async function salesEnded(organizationId: string) {
  await db.entitlement.updateMany({
    where: { organizationId, kind: "MODULE", key: "sales" },
    data: {
      validFrom: new Date(Date.now() - 2 * 86_400_000),
      validUntil: new Date(Date.now() - 86_400_000),
    },
  });
  invalidateEntitlements(organizationId);
}

describe("Ventas without the module (VEN-26)", () => {
  it("knows every service of the module", () => {
    const names = services.map(([name]) => name);
    // Every service is either a read or something that writes.
    expect(names.length).toBeGreaterThan(40);
    for (const read of READS) expect(names, read).toContain(read);
  });

  it("every service refuses without the module, for the titular", async () => {
    const titular = await salesCompany();
    await withoutSales(titular.organizationId);
    for (const [name, service] of services) {
      expect(await call(service, titular), name).toBe("module_not_contracted");
    }
  });

  it("ended, its history is read; nothing is written", async () => {
    const titular = await salesCompany();
    await salesEnded(titular.organizationId);
    const wrong: string[] = [];
    for (const [name, service] of services) {
      const outcome = await call(service, titular);
      const refused =
        outcome === "module_read_only" || outcome === "module_not_contracted";
      if (READS.has(name) === refused) wrong.push(`${name}: ${outcome}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("before taking Ventas away", () => {
  it("the console is told what is left halfway", async () => {
    const titular = await salesCompany();
    // The titular's register was opened by the setup.
    expect(await moduleOpenWork("sales", titular.organizationId)).toEqual([
      "1 caja sigue abierta: haz su corte antes, después ya no se podrá cerrar.",
    ]);
    const product = await createProduct(titular, {
      sku: "G-1",
      name: "Clavo",
    });
    if (!product.ok) throw new Error("product setup failed");
    await registerEntry(titular, {
      productId: product.productId,
      quantity: "5",
    });
    await sales.setSalePrices(titular, product.productId, {
      unitPrice: "10",
      presentations: {},
    });
    const customer = await createCustomer(titular, { name: "Obra Norte" });
    if (!customer.ok) throw new Error("customer setup failed");
    const quote = await sales.createQuote(titular, {
      customerId: customer.customer.id,
      lines: [{ productId: product.productId, capture: "base", quantity: "2" }],
    });
    if (!quote.ok) throw new Error("quote setup failed");
    await sales.markQuoteSent(titular, quote.quoteId);
    await sales.acceptQuote(titular, quote.quoteId);
    await sales.convertQuoteToOrder(titular, quote.quoteId);
    expect(await moduleOpenWork("sales", titular.organizationId)).toEqual([
      "1 caja sigue abierta: haz su corte antes, después ya no se podrá cerrar.",
      "1 pedido espera entrega: lo que falta ya no se podrá entregar ni cobrar.",
    ]);
    // Another company has nothing halfway.
    const other = await salesCompany();
    await withoutSales(other.organizationId);
    await db.cashSession.updateMany({
      where: { organizationId: other.organizationId },
      data: { isOpen: null },
    });
    expect(await moduleOpenWork("sales", other.organizationId)).toEqual([]);
  });
});
