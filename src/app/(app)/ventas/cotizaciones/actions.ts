"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isAppError } from "@/lib";
import {
  QUOTE_MAX_LINES,
  createQuote,
  findSaleProducts,
  getSaleProduct,
  previewQuote,
  updateQuote,
  type QuoteField,
  type QuotePreview,
  type SaleProduct,
  type SaleSearch,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";
import { requireOrganizationContext } from "@/platform/tenancy";

/**
 * Quotes (COT-02). Person and company come from the session; only
 * products and customers of that company are found and quoted.
 */

async function quoter() {
  const access = await getModuleAccess();
  if (!access.allows("sales.quote.create")) return null;
  return { organizationId: access.organization.id, userId: access.user.id };
}

const NOT_ALLOWED = "No tienes permiso para cotizar.";

export async function findQuoteProductsAction(
  query: string,
): Promise<SaleSearch & { error?: string }> {
  const actor = await quoter();
  if (!actor) return { exact: null, candidates: [], error: NOT_ALLOWED };
  return findSaleProducts(actor, String(query ?? "").slice(0, 100));
}

export async function loadQuoteProductAction(
  productId: string,
): Promise<SaleProduct | null> {
  const actor = await quoter();
  if (!actor) return null;
  return getSaleProduct(actor, String(productId));
}

/** The lines as the form sends them: ids and what was typed, cut short. */
function readLines(lines: unknown) {
  const sent = Array.isArray(lines) ? lines.slice(0, QUOTE_MAX_LINES + 1) : [];
  return sent.map((line) => {
    const fields =
      line && typeof line === "object" ? (line as Record<string, unknown>) : {};
    const field = (name: string) =>
      typeof fields[name] === "string" ? fields[name].slice(0, 100) : "";
    return {
      productId: field("productId"),
      capture: field("capture"),
      quantity: field("quantity"),
    };
  });
}

/** What the quote adds up to, computed here; never in the browser. */
export async function previewQuoteAction(
  lines: unknown,
  discountPercent?: unknown,
): Promise<QuotePreview | { error: string }> {
  const actor = await quoter();
  if (!actor) return { error: NOT_ALLOWED };
  return previewQuote(actor, {
    lines: readLines(lines).slice(0, QUOTE_MAX_LINES),
    discountPercent:
      typeof discountPercent === "string" ? discountPercent.slice(0, 16) : "",
  });
}

export type QuoteFormState = {
  fieldErrors: Partial<Record<QuoteField, string>>;
  /** By position of the line sent. */
  lineErrors: Record<number, string>;
  formError?: string;
  /** Answers so far: remounts the fields after an answer. */
  answers: number;
};

/** An id as it may go into an address: nothing but its own characters. */
const idPath = (value: string) =>
  String(value)
    .replace(/[^0-9a-f-]/gi, "")
    .slice(0, 36);

/**
 * Saves a quote: a new one, or a draft when `quoteId` is given. Lines go
 * as JSON with ids and what was typed; prices come from the service.
 */
export async function saveQuoteAction(
  quoteId: string | null,
  prev: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const { user, organization } = await requireOrganizationContext();
  const actor = { organizationId: organization.id, userId: user.id };
  let lines: unknown = [];
  try {
    lines = JSON.parse(String(formData.get("lines") ?? "[]").slice(0, 60_000));
  } catch {
    lines = [];
  }
  const field = (name: string, max: number) =>
    String(formData.get(name) ?? "").slice(0, max);
  const input = {
    customerId: field("customerId", 36),
    validUntil: field("validUntil", 10),
    notes: field("notes", 1100),
    lines: readLines(lines),
    discount: {
      percent: field("discountPercent", 16),
      reason: field("discountReason", 300),
    },
  };
  const answers = prev.answers + 1;
  let result;
  try {
    result = quoteId
      ? await updateQuote(actor, String(quoteId).slice(0, 36), input)
      : await createQuote(actor, input);
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return {
        fieldErrors: {},
        lineErrors: {},
        formError: error.message,
        answers,
      };
    }
    throw error;
  }
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      lineErrors: result.lineErrors,
      formError: result.formError,
      answers,
    };
  }
  revalidatePath("/ventas/cotizaciones");
  redirect(`/ventas/cotizaciones/${idPath(result.quoteId)}`);
}
