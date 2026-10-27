"use server";

import { revalidatePath } from "next/cache";

import { isAppError, newId } from "@/lib";
import {
  SALE_MAX_LINES,
  SALE_MAX_PAYMENTS,
  findSaleByKey,
  findSaleProducts,
  getSaleProduct,
  quoteSale,
  registerSale,
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
import { requireOrganizationContext } from "@/platform/tenancy";

/**
 * The counter (VEN-06..13). Person and company come from the session;
 * only products and customers of that company are found, priced and sold.
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

/** The lines as the form sends them: ids and what was typed, cut short. */
function readLines(lines: unknown) {
  const sent = Array.isArray(lines) ? lines.slice(0, SALE_MAX_LINES + 1) : [];
  return sent.map((line) => {
    const fields =
      line && typeof line === "object" ? (line as Record<string, unknown>) : {};
    const field = (name: string) =>
      typeof fields[name] === "string" ? fields[name].slice(0, 100) : "";
    return {
      productId: field("productId"),
      capture: field("capture"),
      quantity: field("quantity"),
      locationId: field("locationId"),
    };
  });
}

/** The payments as the form sends them: method and what was typed. */
function readPaymentFields(payments: unknown) {
  const sent = Array.isArray(payments)
    ? payments.slice(0, SALE_MAX_PAYMENTS + 1)
    : [];
  return sent.map((payment) => {
    const fields =
      payment && typeof payment === "object"
        ? (payment as Record<string, unknown>)
        : {};
    const field = (name: string) =>
      typeof fields[name] === "string" ? fields[name].slice(0, 100) : "";
    return {
      method: field("method"),
      amount: field("amount"),
      received: field("received"),
      reference: field("reference"),
    };
  });
}

/** Prices, totals and change of the cart, computed here; never in the browser. */
export async function quoteSaleAction(
  lines: unknown,
  payments?: unknown,
): Promise<CartQuote | { error: string }> {
  const actor = await seller();
  if (!actor) return { error: NOT_ALLOWED };
  return quoteSale(actor, {
    lines: readLines(lines).slice(0, SALE_MAX_LINES),
    payments: readPaymentFields(payments),
  });
}

export type SaleFormState = {
  lineErrors: Record<number, string>;
  paymentErrors: Record<number, string>;
  customerError?: string;
  formError?: string;
  /** The sale just charged; the screen shows it and starts a new one. */
  done?: { number: number; total: string; change: string | null };
  /** Key for the next sale (INV-21), created here after a success. */
  nextKey?: string;
};

/**
 * Charges a sale (VEN-09..13). Lines and payments travel as JSON with ids
 * and what was typed; prices, VAT and change are computed by the service.
 * Person and company come from the session.
 */
export async function registerSaleAction(
  _prev: SaleFormState,
  formData: FormData,
): Promise<SaleFormState> {
  const { user, organization } = await requireOrganizationContext();
  const json = (name: string): unknown => {
    try {
      return JSON.parse(String(formData.get(name) ?? "").slice(0, 60_000));
    } catch {
      return [];
    }
  };
  let result;
  try {
    result = await registerSale(
      { organizationId: organization.id, userId: user.id },
      {
        lines: readLines(json("lines")),
        payments: readPaymentFields(json("payments")),
        customerId: String(formData.get("customerId") ?? "").slice(0, 36),
        idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return { lineErrors: {}, paymentErrors: {}, formError: error.message };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      lineErrors: result.lineErrors,
      paymentErrors: result.paymentErrors,
      customerError: result.customerError,
      formError: result.formError,
    };
  }
  revalidatePath("/inventario");
  revalidatePath("/movimientos");
  return {
    lineErrors: {},
    paymentErrors: {},
    done: { number: result.number, total: result.total, change: result.change },
    nextKey: newId(),
  };
}

/** After a lost answer: whether this person's sale with that key exists. */
export async function checkSaleAction(
  key: string,
): Promise<{ number: number } | null> {
  const actor = await seller();
  if (!actor) return null;
  const sale = await findSaleByKey(actor, String(key ?? ""));
  return sale ? { number: sale.number } : null;
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
