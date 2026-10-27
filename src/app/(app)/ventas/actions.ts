"use server";

import {
  SALE_MAX_LINES,
  findSaleProducts,
  getSaleProduct,
  quoteSale,
  type CartQuote,
  type SaleProduct,
  type SaleSearch,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";
import {
  createCustomer,
  findCustomers,
  type CustomerField,
  type CustomerSummary,
} from "@/platform/contacts";

/**
 * The counter (VEN-06). Person and company come from the session; only
 * products of that company are found and priced. These actions only read.
 */

async function seller() {
  const access = await getModuleAccess();
  if (!access.allows("sales.sale.create")) return null;
  return { organizationId: access.organization.id, userId: access.user.id };
}

const NOT_ALLOWED = "No tienes permiso para vender.";

export async function findSaleProductsAction(
  query: string,
): Promise<SaleSearch & { error?: string }> {
  const actor = await seller();
  if (!actor) return { exact: null, candidates: [], error: NOT_ALLOWED };
  return findSaleProducts(actor, String(query ?? "").slice(0, 100));
}

export async function loadSaleProductAction(
  productId: string,
): Promise<SaleProduct | null> {
  const actor = await seller();
  if (!actor) return null;
  return getSaleProduct(actor, String(productId));
}

/** Prices and totals of the cart, computed here; never in the browser. */
export async function quoteSaleAction(
  lines: unknown,
): Promise<CartQuote | { error: string }> {
  const actor = await seller();
  if (!actor) return { error: NOT_ALLOWED };
  const sent = Array.isArray(lines) ? lines.slice(0, SALE_MAX_LINES) : [];
  return quoteSale(actor, {
    lines: sent.map((line) => {
      const fields =
        line && typeof line === "object"
          ? (line as Record<string, unknown>)
          : {};
      const field = (name: string) =>
        typeof fields[name] === "string" ? fields[name].slice(0, 100) : "";
      return {
        productId: field("productId"),
        capture: field("capture"),
        quantity: field("quantity"),
        locationId: field("locationId"),
      };
    }),
  });
}

async function customerActor(
  permission: "sales.customer.read" | "sales.customer.create",
) {
  const access = await getModuleAccess();
  if (!access.allows(permission)) return null;
  return { organizationId: access.organization.id, userId: access.user.id };
}

/** Customers of the company by name, RFC or phone (VEN-08). Reads only. */
export async function findCustomersAction(
  query: string,
): Promise<CustomerSummary[]> {
  const actor = await customerActor("sales.customer.read");
  if (!actor) return [];
  return findCustomers(actor, String(query ?? "").slice(0, 100));
}

export type SaleCustomer = CustomerSummary;

export type NewCustomerState =
  | { status: "idle" }
  | { status: "saved"; customer: CustomerSummary }
  | {
      status: "rejected";
      fieldErrors: Partial<Record<CustomerField, string>>;
      duplicates?: CustomerSummary[];
      formError?: string;
    };

/**
 * Registers a customer at the counter. Only name, phone and RFC travel;
 * the company and the person come from the session.
 */
export async function createCustomerAction(input: {
  name: string;
  phone: string;
  rfc: string;
  acceptDuplicates: boolean;
}): Promise<NewCustomerState> {
  const actor = await customerActor("sales.customer.create");
  if (!actor) {
    return {
      status: "rejected",
      fieldErrors: {},
      formError: "No tienes permiso para registrar clientes.",
    };
  }
  const text = (value: unknown) => String(value ?? "").slice(0, 200);
  const result = await createCustomer(
    actor,
    {
      name: text(input?.name),
      phone: text(input?.phone),
      rfc: text(input?.rfc),
    },
    { acceptDuplicates: input?.acceptDuplicates === true },
  );
  if (result.ok) return { status: "saved", customer: result.customer };
  return {
    status: "rejected",
    fieldErrors: result.fieldErrors,
    ...(result.reason === "duplicate" ? { duplicates: result.duplicates } : {}),
  };
}
