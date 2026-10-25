import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { dec, log } from "@/lib";

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
 * Stripe adapter (ADR 0028): Checkout Session in `payment` mode over the
 * REST API with `fetch`. Payment methods (cards with Google Pay / Apple Pay,
 * OXXO, Link) come from the dashboard's automatic methods.
 */

const API = "https://api.stripe.com/v1";
const CHECKOUT_HOSTS = ["checkout.stripe.com"] as const;
/** Signatures whose timestamp is further than this from now are rejected. */
const SIGNATURE_TOLERANCE_SECONDS = 300;
// Stripe accepts `expires_at` from 30 min to 24 h after creation; a margin on both ends.
const MIN_EXPIRY_SECONDS = 31 * 60;
const MAX_EXPIRY_SECONDS = 23 * 60 * 60 + 55 * 60;
const TIMEOUT_MS = 15_000;

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe no está configurado");
  return key;
}

/** "1214.52" → "121452", exact; rejects fractions of a cent. */
function toCents(total: string): string {
  const cents = dec(total).times(100);
  if (!cents.isInteger() || cents.lte(0)) {
    throw new Error("Importe inválido para Stripe");
  }
  return cents.toFixed(0);
}

async function call(
  path: string,
  init: {
    method: "GET" | "POST";
    body?: URLSearchParams;
    idempotencyKey?: string;
  },
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
  };
  if (init.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  const response = await fetch(`${API}${path}`, {
    method: init.method,
    headers,
    body: init.body?.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok || !data) {
    // Only status and Stripe's error code: its message may echo request data.
    const error = (data?.error ?? {}) as { type?: unknown; code?: unknown };
    log.warn("billing.stripe.request_failed", {
      path: path.split("/").slice(0, 3).join("/"),
      status: response.status,
      stripeType: typeof error.type === "string" ? error.type : null,
      stripeCode: typeof error.code === "string" ? error.code : null,
    });
    throw new Error(`Stripe respondió ${response.status}`);
  }
  return data;
}

function expiresAt(requested: Date): number {
  const now = Math.floor(Date.now() / 1000);
  const wanted = Math.floor(requested.getTime() / 1000);
  return Math.min(
    Math.max(wanted, now + MIN_EXPIRY_SECONDS),
    now + MAX_EXPIRY_SECONDS,
  );
}

function isCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (CHECKOUT_HOSTS as readonly string[]).includes(url.hostname)
    );
  } catch {
    return false;
  }
}

async function createCheckout(
  request: CheckoutRequest,
): Promise<CheckoutSession> {
  if (request.currency !== "MXN") throw new Error("Moneda no soportada");
  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "mxn",
    "line_items[0][price_data][unit_amount]": toCents(request.total),
    "line_items[0][price_data][product_data][name]": request.description,
    client_reference_id: request.orderId,
    "metadata[orderId]": request.orderId,
    "metadata[transactionId]": request.transactionId,
    // So payment_intent.* events also carry the order as a hint.
    "payment_intent_data[metadata][orderId]": request.orderId,
    "payment_intent_data[metadata][transactionId]": request.transactionId,
    customer_email: request.customerEmail,
    success_url: request.returnUrl,
    cancel_url: request.cancelUrl,
    expires_at: String(expiresAt(request.expiresAt)),
    locale: "es-419",
    "payment_method_options[card][request_three_d_secure]": "automatic",
  });
  const session = await call("/checkout/sessions", {
    method: "POST",
    body,
    idempotencyKey: request.orderId,
  });
  if (typeof session.id !== "string" || !isCheckoutUrl(session.url)) {
    log.error("billing.stripe.unexpected_session", undefined, {
      orderId: request.orderId,
    });
    throw new Error("Stripe devolvió una sesión inesperada");
  }
  return { providerRef: session.id, redirectUrl: session.url };
}

/** Parses `t=…,v1=…,v1=…`; null when it is not well formed. */
function parseSignature(
  header: string,
): { timestamp: number; signatures: Buffer[] } | null {
  let timestamp: number | null = null;
  const signatures: Buffer[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) {
      signatures.push(Buffer.from(value, "hex"));
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

async function verifyWebhook(
  request: WebhookRequest,
): Promise<VerifiedWebhook | null> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const header = request.headers.get("stripe-signature");
  if (!secret || !header) return null;
  const parsed = parseSignature(header);
  if (!parsed) return null;
  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (age > SIGNATURE_TOLERANCE_SECONDS) return null;
  const expected = createHmac("sha256", secret)
    .update(`${parsed.timestamp}.${request.rawBody}`, "utf8")
    .digest();
  // Every candidate is compared (no early exit); all are 32 bytes like `expected`.
  let valid = false;
  for (const signature of parsed.signatures) {
    if (timingSafeEqual(signature, expected)) valid = true;
  }
  if (!valid) return null;

  let event: Record<string, unknown>;
  try {
    event = asRecord(JSON.parse(request.rawBody));
  } catch {
    return null;
  }
  const { id, type } = event;
  if (typeof id !== "string" || typeof type !== "string") return null;
  const object = asRecord(asRecord(event.data).object);
  const orderId = asRecord(object.metadata).orderId;
  return {
    eventId: id,
    type,
    providerRef:
      type.startsWith("checkout.session.") && typeof object.id === "string"
        ? object.id
        : null,
    orderId: typeof orderId === "string" ? orderId : null,
  };
}

async function fetchStatus({
  providerRef,
}: CheckoutRef): Promise<PaymentStatus> {
  const session = await call(
    `/checkout/sessions/${encodeURIComponent(providerRef)}`,
    { method: "GET" },
  );
  if (session.payment_status === "paid") {
    const intent = session.payment_intent;
    const paymentRef =
      typeof intent === "string" ? intent : asRecord(intent).id;
    if (
      typeof paymentRef !== "string" ||
      typeof session.amount_total !== "number" ||
      typeof session.currency !== "string"
    ) {
      throw new Error("Stripe devolvió un pago incompleto");
    }
    return {
      state: "paid",
      amount: dec(session.amount_total).dividedBy(100).toFixed(2),
      currency: session.currency.toUpperCase(),
      paymentRef,
    };
  }
  if (session.status === "expired") return { state: "expired" };
  // `open`, or `complete` + `unpaid` while an OXXO voucher waits to be paid.
  return { state: "pending" };
}

export const stripeProvider: PaymentProvider = {
  id: "stripe",
  label: "Tarjeta, Google Pay, Apple Pay u OXXO",
  checkoutHosts: CHECKOUT_HOSTS,
  enabled: () =>
    Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
  createCheckout,
  verifyWebhook,
  fetchStatus,
};
