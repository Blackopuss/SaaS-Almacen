import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { log } from "@/lib";

import type {
  CheckoutRef,
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
  PaymentStatus,
  VerifiedWebhook,
  WebhookRequest,
} from "./provider";

/**
 * Mercado Pago adapter (ADR 0028): Checkout Pro for Mexico, over its REST
 * API with `fetch`. The customer pays on Mercado Pago's page (card, OXXO,
 * transfer); a payment is linked to our order by `external_reference`.
 */

const API = "https://api.mercadopago.com";
const HOSTS = ["www.mercadopago.com.mx", "sandbox.mercadopago.com.mx"] as const;
const WEBHOOK_PATH = "/api/pagos/mercadopago/webhook";
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;
/** Placeholder replaced by the amount literal after serializing the body. */
const UNIT_PRICE = "__almacen_unit_price__";

const token = () => process.env.MERCADOPAGO_ACCESS_TOKEN ?? "";
const secret = () => process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "";

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * The preference body with `unit_price` as the exact decimal literal of the
 * total: it is spliced into the JSON text, never converted to a JS number,
 * so no float can alter it (AGENTS.md: money is never a float). The
 * placeholder cannot match inside another string: JSON escapes its quotes.
 */
export function preferenceBody(request: CheckoutRequest): string {
  if (!/^\d{1,10}\.\d{2}$/.test(request.total)) {
    throw new Error("Importe inválido para Mercado Pago");
  }
  const notificationUrl = webhookUrl();
  const body = {
    items: [
      {
        id: request.transactionId,
        title: request.description,
        quantity: 1,
        currency_id: request.currency,
        unit_price: UNIT_PRICE,
      },
    ],
    external_reference: request.orderId,
    payer: { email: request.customerEmail },
    back_urls: {
      success: request.returnUrl,
      pending: request.returnUrl,
      failure: request.cancelUrl,
    },
    auto_return: "approved",
    ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    expires: true,
    expiration_date_to: request.expiresAt.toISOString(),
    statement_descriptor: "ALMACEN",
    // OXXO and transfers stay pending for days: allow that state.
    binary_mode: false,
  };
  return JSON.stringify(body).replace(`"${UNIT_PRICE}"`, request.total);
}

/** Our webhook URL, only when https (Mercado Pago rejects others; local dev has none). */
function webhookUrl(): string | null {
  const base = process.env.BETTER_AUTH_URL ?? "";
  if (!base.startsWith("https://")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BETTER_AUTH_URL debe ser https para Mercado Pago");
    }
    return null;
  }
  // source_news=webhooks: only the signed webhooks, not the legacy IPN too.
  return `${new URL(WEBHOOK_PATH, base).toString()}?source_news=webhooks`;
}

async function createCheckout(
  request: CheckoutRequest,
): Promise<CheckoutSession> {
  const response = await call("/checkout/preferences", {
    method: "POST",
    headers: { "X-Idempotency-Key": request.orderId },
    body: preferenceBody(request),
  });
  if (!response.ok) {
    log.warn("mercadopago.preference_failed", {
      orderId: request.orderId,
      status: response.status,
    });
    throw new Error(`Mercado Pago respondió ${response.status}`);
  }
  const preference = (await response.json()) as {
    id?: unknown;
    init_point?: unknown;
    sandbox_init_point?: unknown;
  };
  const redirect =
    process.env.MERCADOPAGO_ENV === "sandbox"
      ? preference.sandbox_init_point
      : preference.init_point;
  if (typeof preference.id !== "string" || !isCheckoutUrl(redirect)) {
    log.warn("mercadopago.preference_unexpected", { orderId: request.orderId });
    throw new Error("Mercado Pago no devolvió una página de pago válida");
  }
  return { providerRef: preference.id, redirectUrl: redirect };
}

function isCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (HOSTS as readonly string[]).includes(url.hostname)
    );
  } catch {
    return false;
  }
}

type Payment = {
  id?: unknown;
  status?: unknown;
  transaction_amount?: unknown;
  currency_id?: unknown;
};

/**
 * `transaction_amount` arrives as a JSON number. `String()` gives the
 * shortest literal that round-trips, which for an amount of up to 15
 * significant digits is exactly what Mercado Pago wrote; no arithmetic is
 * done on it. Anything that is not 0–2 decimals is returned as is, so the
 * core's comparison with the order rejects it.
 */
export function exactAmount(value: unknown): string {
  const text = String(value);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  return match ? `${match[1]}.${(match[2] ?? "").padEnd(2, "0")}` : text;
}

async function fetchStatus(ref: CheckoutRef): Promise<PaymentStatus> {
  const query = new URLSearchParams({
    external_reference: ref.orderId,
    sort: "date_created",
    criteria: "desc",
  });
  const response = await call(`/v1/payments/search?${query}`);
  if (!response.ok) {
    log.warn("mercadopago.search_failed", {
      orderId: ref.orderId,
      status: response.status,
    });
    throw new Error(`Mercado Pago respondió ${response.status}`);
  }
  const { results } = (await response.json()) as { results?: Payment[] };
  const payments = Array.isArray(results) ? results : [];

  const approved = payments.find((payment) => payment.status === "approved");
  if (approved) {
    return {
      state: "paid",
      amount: exactAmount(approved.transaction_amount),
      currency: String(approved.currency_id),
      paymentRef: String(approved.id),
    };
  }
  if (payments.length === 0) return { state: "pending" };
  const allFailed = payments.every(
    (payment) =>
      payment.status === "rejected" || payment.status === "cancelled",
  );
  // A rejected card can be retried on the same page until it expires.
  if (allFailed && (await preferenceExpired(ref.providerRef))) {
    return { state: "failed" };
  }
  return { state: "pending" };
}

async function preferenceExpired(preferenceId: string): Promise<boolean> {
  const response = await call(
    `/checkout/preferences/${encodeURIComponent(preferenceId)}`,
  );
  if (!response.ok) {
    log.warn("mercadopago.preference_read_failed", {
      preferenceId,
      status: response.status,
    });
    throw new Error(`Mercado Pago respondió ${response.status}`);
  }
  const { expiration_date_to: until } = (await response.json()) as {
    expiration_date_to?: unknown;
  };
  if (typeof until !== "string") return false;
  const at = Date.parse(until);
  return Number.isFinite(at) && at <= Date.now();
}

/** `ts=…,v1=…` → its parts; null when either is missing or malformed. */
function parseSignature(header: string | null) {
  if (!header) return null;
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const at = piece.indexOf("=");
    if (at > 0) {
      parts.set(piece.slice(0, at).trim(), piece.slice(at + 1).trim());
    }
  }
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !/^\d{1,16}$/.test(ts) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) {
    return null;
  }
  return { ts, v1: v1.toLowerCase() };
}

async function verifyWebhook({
  headers,
  rawBody,
  url,
}: WebhookRequest): Promise<VerifiedWebhook | null> {
  const key = secret();
  const signature = parseSignature(headers.get("x-signature"));
  const requestId = headers.get("x-request-id");
  if (!key || !signature || !requestId) return null;

  let body: { id?: unknown; type?: unknown; data?: { id?: unknown } } = {};
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    // The signature covers the query, not the body: go on without it.
  }
  const bodyId = body.data?.id;
  const rawId =
    url.searchParams.get("data.id") ??
    (typeof bodyId === "string" || typeof bodyId === "number"
      ? String(bodyId)
      : null);
  if (!rawId) return null;
  // Mercado Pago signs alphanumeric ids in lowercase.
  const dataId = /^[a-z0-9]+$/i.test(rawId) ? rawId.toLowerCase() : rawId;

  const ts = Number(signature.ts);
  const sentAt = ts < 1e12 ? ts * 1000 : ts; // seconds or milliseconds
  if (Math.abs(Date.now() - sentAt) > MAX_SIGNATURE_AGE_MS) return null;

  const manifest = `id:${dataId};request-id:${requestId};ts:${signature.ts};`;
  const expected = createHmac("sha256", key).update(manifest).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.v1, "hex"))) {
    return null;
  }

  const type =
    url.searchParams.get("type") ??
    url.searchParams.get("topic") ??
    (typeof body.type === "string" ? body.type : "unknown");
  const eventId =
    typeof body.id === "string" || typeof body.id === "number"
      ? String(body.id)
      : `${type}:${dataId}:${signature.ts}`;

  let orderId: string | null = null;
  if (type === "payment") {
    const response = await call(`/v1/payments/${encodeURIComponent(dataId)}`);
    if (response.ok) {
      const { external_reference: reference } = (await response.json()) as {
        external_reference?: unknown;
      };
      orderId = typeof reference === "string" && reference ? reference : null;
    } else if (response.status !== 404) {
      log.warn("mercadopago.payment_read_failed", {
        paymentId: dataId,
        status: response.status,
      });
      throw new Error(`Mercado Pago respondió ${response.status}`);
    }
  }
  return { eventId, type, providerRef: null, orderId };
}

export const mercadopagoProvider: PaymentProvider = {
  id: "mercadopago",
  label: "Mercado Pago",
  checkoutHosts: HOSTS,
  enabled: () => Boolean(token() && secret()),
  createCheckout,
  verifyWebhook,
  fetchStatus,
};
