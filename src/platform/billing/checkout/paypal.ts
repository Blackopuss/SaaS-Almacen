import "server-only";

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
 * PayPal adapter (ADR 0028): Orders v2 with `intent: CAPTURE` over REST,
 * no SDK. The customer approves on PayPal's page; we capture when we read
 * the order (`fetchStatus`), so a payment only counts once PayPal says the
 * capture is COMPLETED.
 */

const HOSTS = ["www.paypal.com", "www.sandbox.paypal.com"] as const;

function config() {
  const live = process.env.PAYPAL_ENV === "live";
  return {
    base: live
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com",
    clientId: process.env.PAYPAL_CLIENT_ID ?? "",
    secret: process.env.PAYPAL_CLIENT_SECRET ?? "",
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
  };
}

let cachedToken: { key: string; value: string; expiresAt: number } | null =
  null;

async function accessToken(): Promise<string> {
  const { base, clientId, secret } = config();
  const key = `${base}|${clientId}`;
  if (cachedToken?.key === key && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    log.error("paypal.token_failed", undefined, { status: response.status });
    throw new Error(`PayPal rechazó las credenciales (${response.status})`);
  }
  const body = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof body.access_token !== "string") {
    throw new Error("PayPal no devolvió un token");
  }
  const seconds = typeof body.expires_in === "number" ? body.expires_in : 0;
  // Renew a minute early so a token never expires mid-request.
  cachedToken = {
    key,
    value: body.access_token,
    expiresAt: Date.now() + Math.max(0, seconds - 60) * 1000,
  };
  return body.access_token;
}

async function api(
  path: string,
  init: { method: "GET" | "POST"; body?: string; requestId?: string },
): Promise<Response> {
  const token = await accessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (init.requestId) headers["PayPal-Request-Id"] = init.requestId;
  const response = await fetch(`${config().base}${path}`, {
    method: init.method,
    headers,
    body: init.body,
  });
  if (response.status === 401) cachedToken = null;
  return response;
}

function failure(event: string, response: Response, fields: object): Error {
  log.error(event, undefined, {
    ...fields,
    status: response.status,
    debugId: response.headers.get("paypal-debug-id"),
  });
  return new Error(`PayPal respondió ${response.status}`);
}

type Capture = {
  id?: unknown;
  status?: unknown;
  amount?: { value?: unknown; currency_code?: unknown };
};
type Order = {
  id?: unknown;
  status?: unknown;
  links?: { rel?: unknown; href?: unknown }[];
  purchase_units?: { payments?: { captures?: Capture[] } }[];
};

function captureStatus(order: Order): PaymentStatus {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  switch (capture?.status) {
    case "COMPLETED": {
      const { value, currency_code } = capture.amount ?? {};
      if (
        typeof capture.id !== "string" ||
        typeof value !== "string" ||
        typeof currency_code !== "string"
      ) {
        throw new Error("PayPal devolvió un cobro incompleto");
      }
      return {
        state: "paid",
        amount: value,
        currency: currency_code,
        paymentRef: capture.id,
      };
    }
    case "DECLINED":
    case "FAILED":
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return { state: "failed" };
    default:
      // PENDING (e.g. under review) or no capture yet.
      return { state: "pending" };
  }
}

async function readOrder(providerRef: string): Promise<Order | null> {
  const response = await api(
    `/v2/checkout/orders/${encodeURIComponent(providerRef)}`,
    { method: "GET" },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw failure("paypal.order_read_failed", response, { providerRef });
  }
  return (await response.json()) as Order;
}

async function capture(providerRef: string): Promise<PaymentStatus> {
  const response = await api(
    `/v2/checkout/orders/${encodeURIComponent(providerRef)}/capture`,
    { method: "POST", body: "{}", requestId: `capture-${providerRef}` },
  );
  if (response.ok) return captureStatus((await response.json()) as Order);
  if (response.status === 404) return { state: "expired" };
  if (response.status === 422) {
    const body = (await response.json().catch(() => ({}))) as {
      details?: { issue?: unknown }[];
    };
    const issue = body.details?.[0]?.issue;
    if (issue === "ORDER_ALREADY_CAPTURED") {
      // Captured by a parallel request: the order now carries the capture.
      const order = await readOrder(providerRef);
      return order ? captureStatus(order) : { state: "expired" };
    }
    // INSTRUMENT_DECLINED, ORDER_NOT_APPROVED…: this checkout will not pay.
    log.warn("paypal.capture_rejected", { providerRef, issue: String(issue) });
    return { state: "failed" };
  }
  throw failure("paypal.capture_failed", response, { providerRef });
}

async function createCheckout(
  request: CheckoutRequest,
): Promise<CheckoutSession> {
  const response = await api("/v2/checkout/orders", {
    method: "POST",
    requestId: request.orderId,
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: request.orderId,
          custom_id: request.orderId,
          invoice_id: request.transactionId,
          description: request.description,
          amount: { currency_code: request.currency, value: request.total },
        },
      ],
      payment_source: {
        paypal: {
          email_address: request.customerEmail,
          experience_context: {
            return_url: request.returnUrl,
            cancel_url: request.cancelUrl,
            locale: "es-MX",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            brand_name: "Almacén",
          },
        },
      },
    }),
  });
  if (!response.ok) {
    throw failure("paypal.checkout_failed", response, {
      orderId: request.orderId,
    });
  }
  const order = (await response.json()) as Order;
  const link =
    order.links?.find((l) => l.rel === "payer-action") ??
    order.links?.find((l) => l.rel === "approve");
  let url: URL | null = null;
  try {
    url = new URL(String(link?.href));
  } catch {}
  if (
    typeof order.id !== "string" ||
    !url ||
    url.protocol !== "https:" ||
    !(HOSTS as readonly string[]).includes(url.hostname)
  ) {
    log.error("paypal.checkout_bad_link", undefined, {
      orderId: request.orderId,
    });
    throw new Error("PayPal no devolvió una página de pago válida");
  }
  return { providerRef: order.id, redirectUrl: url.toString() };
}

async function fetchStatus({
  providerRef,
}: CheckoutRef): Promise<PaymentStatus> {
  const order = await readOrder(providerRef);
  if (!order) return { state: "expired" };
  switch (order.status) {
    case "COMPLETED":
      return captureStatus(order);
    case "APPROVED":
      return capture(providerRef);
    case "VOIDED":
      return { state: "failed" };
    default:
      // CREATED, SAVED, PAYER_ACTION_REQUIRED: the customer has not paid yet.
      return { state: "pending" };
  }
}

const SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

type WebhookEvent = {
  id?: unknown;
  event_type?: unknown;
  resource?: {
    id?: unknown;
    custom_id?: unknown;
    purchase_units?: { custom_id?: unknown }[];
    supplementary_data?: { related_ids?: { order_id?: unknown } };
  };
};

async function verifyWebhook({
  headers,
  rawBody,
}: WebhookRequest): Promise<VerifiedWebhook | null> {
  const { webhookId } = config();
  if (!webhookId) return null;
  const fields: Record<string, string> = {};
  for (const [field, header] of Object.entries(SIGNATURE_HEADERS)) {
    const value = headers.get(header);
    if (!value) return null;
    fields[field] = value;
  }
  let event: WebhookEvent | null;
  try {
    event = JSON.parse(rawBody) as WebhookEvent | null;
  } catch {
    return null;
  }
  if (
    !event ||
    typeof event !== "object" ||
    typeof event.id !== "string" ||
    typeof event.event_type !== "string"
  ) {
    return null;
  }
  // The raw body goes in as it arrived (already checked to be JSON):
  // re-serializing it could change bytes and fail PayPal's signature check.
  const body = `${JSON.stringify({ ...fields, webhook_id: webhookId }).slice(0, -1)},"webhook_event":${rawBody}}`;
  const response = await api("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body,
  });
  // PayPal answers 400/422 to malformed signature fields: attacker input.
  if (response.status === 400 || response.status === 422) {
    log.warn("paypal.webhook_rejected", { status: response.status });
    return null;
  }
  if (!response.ok) {
    throw failure("paypal.webhook_verify_failed", response, {
      eventId: event.id,
    });
  }
  const result = (await response.json()) as { verification_status?: unknown };
  if (result.verification_status !== "SUCCESS") {
    log.warn("paypal.webhook_unverified", { eventId: event.id });
    return null;
  }
  const resource = event.resource ?? {};
  const type = event.event_type;
  const ref = type.startsWith("CHECKOUT.ORDER.")
    ? resource.id
    : type.startsWith("PAYMENT.CAPTURE.")
      ? resource.supplementary_data?.related_ids?.order_id
      : null;
  const customId =
    resource.custom_id ?? resource.purchase_units?.[0]?.custom_id;
  return {
    eventId: event.id,
    type,
    providerRef: typeof ref === "string" ? ref : null,
    orderId: typeof customId === "string" ? customId : null,
  };
}

export const paypalProvider: PaymentProvider = {
  id: "paypal",
  label: "PayPal",
  checkoutHosts: HOSTS,
  enabled: () => {
    const { clientId, secret, webhookId } = config();
    return Boolean(clientId && secret && webhookId);
  },
  createCheckout,
  verifyWebhook,
  fetchStatus,
};
