import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaymentProvider } from "@/platform/billing/checkout/provider";

// Each test loads a fresh module so the in-memory token cache starts empty.
async function load(): Promise<PaymentProvider> {
  vi.resetModules();
  return (await import("@/platform/billing/checkout/paypal")).paypalProvider;
}

type Call = { url: string; init: RequestInit };
let calls: Call[];
let routes: Record<string, () => Response>;

const SANDBOX = "https://api-m.sandbox.paypal.com";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const tokenResponse = () =>
  json(200, { access_token: "tok-1", expires_in: 32400 });

beforeEach(() => {
  vi.stubEnv("PAYPAL_ENV", "");
  vi.stubEnv("PAYPAL_CLIENT_ID", "client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
  vi.stubEnv("PAYPAL_WEBHOOK_ID", "WH-1");
  calls = [];
  routes = { "POST /v1/oauth2/token": tokenResponse };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const key = `${init.method} ${new URL(url).pathname}`;
      const route = routes[key];
      if (!route) throw new Error(`ruta inesperada ${key}`);
      return route();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const header = (call: Call, name: string) =>
  (call.init.headers as Record<string, string>)[name];

const request = {
  orderId: "0190f0aa-0000-7000-8000-000000000001",
  transactionId: "AL-7F3K9Q2M",
  description: "Almacén · 1,000 productos · 3 meses",
  total: "1214.50",
  currency: "MXN" as const,
  customerEmail: "titular@example.test",
  returnUrl: "https://almacen.test/pago/estado",
  cancelUrl: "https://almacen.test/pago/cancelado",
  expiresAt: new Date(Date.now() + 3_600_000),
};

const orderWith = (status: string, captureStatus?: string) => ({
  id: "PP-ORDER-1",
  status,
  purchase_units: [
    {
      payments: captureStatus
        ? {
            captures: [
              {
                id: "CAP-1",
                status: captureStatus,
                amount: { value: "1214.50", currency_code: "MXN" },
              },
            ],
          }
        : undefined,
    },
  ],
});

describe("PayPal", () => {
  it("se activa solo con id, secreto y webhook", async () => {
    const paypal = await load();
    expect(paypal.enabled()).toBe(true);
    vi.stubEnv("PAYPAL_WEBHOOK_ID", "");
    expect(paypal.enabled()).toBe(false);
    expect(paypal.checkoutHosts).toEqual([
      "www.paypal.com",
      "www.sandbox.paypal.com",
    ]);
  });

  it("crea la orden con el importe exacto y guarda el token", async () => {
    const paypal = await load();
    routes["POST /v2/checkout/orders"] = () =>
      json(200, {
        id: "PP-ORDER-1",
        status: "PAYER_ACTION_REQUIRED",
        links: [
          { rel: "self", href: `${SANDBOX}/v2/checkout/orders/PP-ORDER-1` },
          {
            rel: "payer-action",
            href: "https://www.sandbox.paypal.com/checkoutnow?token=PP-ORDER-1",
          },
        ],
      });
    const session = await paypal.createCheckout(request);
    expect(session).toEqual({
      providerRef: "PP-ORDER-1",
      redirectUrl:
        "https://www.sandbox.paypal.com/checkoutnow?token=PP-ORDER-1",
    });

    const [token, create] = calls as [Call, Call];
    expect(token.url).toBe(`${SANDBOX}/v1/oauth2/token`);
    expect(header(token, "Authorization")).toBe(
      `Basic ${Buffer.from("client:secret").toString("base64")}`,
    );
    expect(create.url).toBe(`${SANDBOX}/v2/checkout/orders`);
    expect(header(create, "Authorization")).toBe("Bearer tok-1");
    expect(header(create, "PayPal-Request-Id")).toBe(request.orderId);
    const body = JSON.parse(String(create.init.body));
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units).toEqual([
      {
        reference_id: request.orderId,
        custom_id: request.orderId,
        invoice_id: "AL-7F3K9Q2M",
        description: request.description,
        amount: { currency_code: "MXN", value: "1214.50" },
      },
    ]);
    expect(body.payment_source.paypal.experience_context).toEqual({
      return_url: request.returnUrl,
      cancel_url: request.cancelUrl,
      locale: "es-MX",
      user_action: "PAY_NOW",
      shipping_preference: "NO_SHIPPING",
      brand_name: "Almacén",
    });

    // Second call reuses the cached token.
    await paypal.createCheckout(request);
    expect(calls.filter((c) => c.url.endsWith("/oauth2/token"))).toHaveLength(
      1,
    );
  });

  it("usa la API de producción con PAYPAL_ENV=live", async () => {
    vi.stubEnv("PAYPAL_ENV", "live");
    const paypal = await load();
    routes["GET /v2/checkout/orders/PP-ORDER-1"] = () =>
      json(200, orderWith("CREATED"));
    await paypal.fetchStatus({ providerRef: "PP-ORDER-1", orderId: "x" });
    expect(
      calls.every((c) => c.url.startsWith("https://api-m.paypal.com/")),
    ).toBe(true);
  });

  it("rechaza un enlace de pago fuera de PayPal", async () => {
    const paypal = await load();
    for (const href of [
      "https://www.paypal.com.evil.test/checkoutnow",
      "http://www.paypal.com/checkoutnow",
    ]) {
      routes["POST /v2/checkout/orders"] = () =>
        json(200, { id: "PP-ORDER-1", links: [{ rel: "approve", href }] });
      await expect(paypal.createCheckout(request)).rejects.toThrow(
        "página de pago",
      );
    }
  });

  it("traduce los estados de la orden", async () => {
    const paypal = await load();
    const ref = { providerRef: "PP-ORDER-1", orderId: request.orderId };
    const cases: [unknown, string][] = [
      [orderWith("CREATED"), "pending"],
      [orderWith("PAYER_ACTION_REQUIRED"), "pending"],
      [orderWith("VOIDED"), "failed"],
      [orderWith("COMPLETED", "PENDING"), "pending"],
      [orderWith("COMPLETED", "DECLINED"), "failed"],
    ];
    for (const [order, state] of cases) {
      routes["GET /v2/checkout/orders/PP-ORDER-1"] = () => json(200, order);
      expect((await paypal.fetchStatus(ref)).state).toBe(state);
    }
    routes["GET /v2/checkout/orders/PP-ORDER-1"] = () =>
      json(200, orderWith("COMPLETED", "COMPLETED"));
    expect(await paypal.fetchStatus(ref)).toEqual({
      state: "paid",
      amount: "1214.50",
      currency: "MXN",
      paymentRef: "CAP-1",
    });
    routes["GET /v2/checkout/orders/PP-ORDER-1"] = () =>
      json(404, { name: "RESOURCE_NOT_FOUND" });
    expect(await paypal.fetchStatus(ref)).toEqual({ state: "expired" });
    routes["GET /v2/checkout/orders/PP-ORDER-1"] = () => json(500, {});
    await expect(paypal.fetchStatus(ref)).rejects.toThrow("500");
  });

  it("cobra una orden aprobada y trata el rechazo", async () => {
    const paypal = await load();
    const ref = { providerRef: "PP-ORDER-1", orderId: request.orderId };
    routes["GET /v2/checkout/orders/PP-ORDER-1"] = () =>
      json(200, orderWith("APPROVED"));
    routes["POST /v2/checkout/orders/PP-ORDER-1/capture"] = () =>
      json(201, orderWith("COMPLETED", "COMPLETED"));
    expect(await paypal.fetchStatus(ref)).toMatchObject({
      state: "paid",
      paymentRef: "CAP-1",
    });
    const capture = calls.find((c) => c.url.endsWith("/capture"))!;
    expect(header(capture, "PayPal-Request-Id")).toBe("capture-PP-ORDER-1");

    routes["POST /v2/checkout/orders/PP-ORDER-1/capture"] = () =>
      json(201, orderWith("COMPLETED", "DECLINED"));
    expect(await paypal.fetchStatus(ref)).toEqual({ state: "failed" });

    routes["POST /v2/checkout/orders/PP-ORDER-1/capture"] = () =>
      json(422, { details: [{ issue: "INSTRUMENT_DECLINED" }] });
    expect(await paypal.fetchStatus(ref)).toEqual({ state: "failed" });
  });

  it("si ya se cobró, vuelve a leer la orden", async () => {
    const paypal = await load();
    let reads = 0;
    routes["GET /v2/checkout/orders/PP-ORDER-1"] = () =>
      json(
        200,
        reads++ === 0
          ? orderWith("APPROVED")
          : orderWith("COMPLETED", "COMPLETED"),
      );
    routes["POST /v2/checkout/orders/PP-ORDER-1/capture"] = () =>
      json(422, { details: [{ issue: "ORDER_ALREADY_CAPTURED" }] });
    expect(
      await paypal.fetchStatus({ providerRef: "PP-ORDER-1", orderId: "x" }),
    ).toMatchObject({ state: "paid", paymentRef: "CAP-1" });
    expect(reads).toBe(2);
  });

  describe("webhook", () => {
    const signed = () =>
      new Headers({
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url":
          "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
        "paypal-transmission-id": "T-1",
        "paypal-transmission-sig": "SIG",
        "paypal-transmission-time": "2026-10-25T12:00:00Z",
      });
    const url = new URL("https://almacen.test/api/pagos/paypal/webhook");

    it("acepta un evento verificado", async () => {
      const paypal = await load();
      routes["POST /v1/notifications/verify-webhook-signature"] = () =>
        json(200, { verification_status: "SUCCESS" });
      const rawBody = JSON.stringify({
        id: "WH-EVT-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-1",
          custom_id: request.orderId,
          supplementary_data: { related_ids: { order_id: "PP-ORDER-1" } },
        },
      });
      expect(
        await paypal.verifyWebhook({ headers: signed(), rawBody, url }),
      ).toEqual({
        eventId: "WH-EVT-1",
        type: "PAYMENT.CAPTURE.COMPLETED",
        providerRef: "PP-ORDER-1",
        orderId: request.orderId,
      });
      const verify = calls.find((c) =>
        c.url.endsWith("verify-webhook-signature"),
      )!;
      expect(JSON.parse(String(verify.init.body))).toEqual({
        auth_algo: "SHA256withRSA",
        cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT",
        transmission_id: "T-1",
        transmission_sig: "SIG",
        transmission_time: "2026-10-25T12:00:00Z",
        webhook_id: "WH-1",
        webhook_event: JSON.parse(rawBody),
      });

      const orderEvent = JSON.stringify({
        id: "WH-EVT-2",
        event_type: "CHECKOUT.ORDER.APPROVED",
        resource: { id: "PP-ORDER-1", purchase_units: [{ custom_id: "o-1" }] },
      });
      expect(
        await paypal.verifyWebhook({
          headers: signed(),
          rawBody: orderEvent,
          url,
        }),
      ).toMatchObject({ providerRef: "PP-ORDER-1", orderId: "o-1" });
    });

    it("rechaza firmas inválidas, cabeceras faltantes y JSON roto", async () => {
      const paypal = await load();
      const rawBody = JSON.stringify({
        id: "E",
        event_type: "X",
        resource: {},
      });
      routes["POST /v1/notifications/verify-webhook-signature"] = () =>
        json(200, { verification_status: "FAILURE" });
      expect(
        await paypal.verifyWebhook({ headers: signed(), rawBody, url }),
      ).toBeNull();

      routes["POST /v1/notifications/verify-webhook-signature"] = () =>
        json(400, { name: "VALIDATION_ERROR" });
      expect(
        await paypal.verifyWebhook({ headers: signed(), rawBody, url }),
      ).toBeNull();

      const before = calls.length;
      const missing = signed();
      missing.delete("paypal-transmission-sig");
      expect(
        await paypal.verifyWebhook({ headers: missing, rawBody, url }),
      ).toBeNull();
      expect(
        await paypal.verifyWebhook({ headers: signed(), rawBody: "{no", url }),
      ).toBeNull();
      expect(calls.length).toBe(before);

      routes["POST /v1/notifications/verify-webhook-signature"] = () =>
        json(503, {});
      await expect(
        paypal.verifyWebhook({ headers: signed(), rawBody, url }),
      ).rejects.toThrow("503");
    });
  });
});
