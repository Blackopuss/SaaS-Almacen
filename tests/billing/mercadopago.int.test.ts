import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exactAmount,
  mercadopagoProvider as mp,
  preferenceBody,
} from "@/platform/billing/checkout/mercadopago";
import type { CheckoutRequest } from "@/platform/billing/checkout/provider";

// ADR 0028: Mercado Pago adapter against a fake `fetch` (no network).

const SECRET = "secreto-de-prueba";
const ORDER = "0190f0c2-0000-7000-8000-000000000001";

const request = (total: string): CheckoutRequest => ({
  orderId: ORDER,
  transactionId: "AL-7F3K9Q2M",
  description: 'Almacén · 1,000 productos "__almacen_unit_price__"',
  total,
  currency: "MXN",
  customerEmail: "titular@example.test",
  returnUrl: "https://almacen.example/pago/estado",
  cancelUrl: "https://almacen.example/pago/cancelado",
  expiresAt: new Date("2026-11-01T00:00:00.000Z"),
});

type Call = { url: string; init: RequestInit };
let calls: Call[];

function fakeFetch(...responses: Array<[number, unknown]>) {
  calls = [];
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      const [status, body] = queue.shift() ?? [500, {}];
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-123");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("MERCADOPAGO_ENV", "sandbox");
  vi.stubEnv("BETTER_AUTH_URL", "https://almacen.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createCheckout", () => {
  it("writes the total as the exact literal and every field", () => {
    for (const total of ["1214.52", "0.10", "9999999999.99"]) {
      const text = preferenceBody(request(total));
      expect(text).toContain(`"unit_price":${total}}`);
      const body = JSON.parse(text);
      expect(body.items[0].title).toContain('"__almacen_unit_price__"');
      expect(body).toMatchObject({
        external_reference: ORDER,
        payer: { email: "titular@example.test" },
        back_urls: {
          success: "https://almacen.example/pago/estado",
          pending: "https://almacen.example/pago/estado",
          failure: "https://almacen.example/pago/cancelado",
        },
        auto_return: "approved",
        notification_url:
          "https://almacen.example/api/pagos/mercadopago/webhook?source_news=webhooks",
        expires: true,
        expiration_date_to: "2026-11-01T00:00:00.000Z",
        statement_descriptor: "ALMACEN",
        binary_mode: false,
      });
      expect(body.items[0]).toMatchObject({
        id: "AL-7F3K9Q2M",
        quantity: 1,
        currency_id: "MXN",
      });
    }
    for (const total of ["1214.5", "12e3", "-1.00", "1.005", ""]) {
      expect(() => preferenceBody(request(total))).toThrow();
    }
  });

  it("omits the webhook URL when the app is not on https", () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    expect(JSON.parse(preferenceBody(request("1.00")))).not.toHaveProperty(
      "notification_url",
    );
  });

  it("sends the idempotency key and returns the page for the environment", async () => {
    const preference = {
      id: "pref-1",
      init_point:
        "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1",
      sandbox_init_point:
        "https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=1",
    };
    fakeFetch([201, preference]);
    await expect(mp.createCheckout(request("1214.52"))).resolves.toEqual({
      providerRef: "pref-1",
      redirectUrl: preference.sandbox_init_point,
    });
    expect(calls[0]?.url).toBe(
      "https://api.mercadopago.com/checkout/preferences",
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["X-Idempotency-Key"]).toBe(ORDER);
    expect(headers.Authorization).toBe("Bearer TEST-123");

    vi.stubEnv("MERCADOPAGO_ENV", "live");
    fakeFetch([201, preference]);
    await expect(mp.createCheckout(request("1.00"))).resolves.toMatchObject({
      redirectUrl: preference.init_point,
    });
  });

  it("rejects a page outside Mercado Pago or a failed answer", async () => {
    for (const bad of [
      "https://evil.example/checkout",
      "http://sandbox.mercadopago.com.mx/x",
      "https://sandbox.mercadopago.com.mx.evil.example/x",
    ]) {
      fakeFetch([201, { id: "pref-1", sandbox_init_point: bad }]);
      await expect(mp.createCheckout(request("1.00"))).rejects.toThrow();
    }
    fakeFetch([400, { message: "bad" }]);
    await expect(mp.createCheckout(request("1.00"))).rejects.toThrow();
  });

  it("is enabled only with token and secret", () => {
    expect(mp.enabled()).toBe(true);
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "");
    expect(mp.enabled()).toBe(false);
  });
});

describe("fetchStatus", () => {
  const ref = { providerRef: "pref-1", orderId: ORDER };
  const past = { expiration_date_to: "2020-01-01T00:00:00.000-06:00" };
  const future = { expiration_date_to: "2999-01-01T00:00:00.000-06:00" };

  it("maps the payments of the order", async () => {
    fakeFetch([
      200,
      {
        results: [
          { id: 2, status: "rejected" },
          {
            id: 1,
            status: "approved",
            transaction_amount: 1214.5,
            currency_id: "MXN",
          },
        ],
      },
    ]);
    await expect(mp.fetchStatus(ref)).resolves.toEqual({
      state: "paid",
      amount: "1214.50",
      currency: "MXN",
      paymentRef: "1",
    });
    expect(calls[0]?.url).toContain(`external_reference=${ORDER}`);

    fakeFetch([
      200,
      { results: [{ status: "rejected" }, { status: "in_process" }] },
    ]);
    await expect(mp.fetchStatus(ref)).resolves.toEqual({ state: "pending" });

    fakeFetch([200, { results: [] }]);
    await expect(mp.fetchStatus(ref)).resolves.toEqual({ state: "pending" });

    fakeFetch([200, { results: [{ status: "rejected" }] }], [200, future]);
    await expect(mp.fetchStatus(ref)).resolves.toEqual({ state: "pending" });

    fakeFetch([200, { results: [{ status: "cancelled" }] }], [200, past]);
    await expect(mp.fetchStatus(ref)).resolves.toEqual({ state: "failed" });
    expect(calls[1]?.url).toBe(
      "https://api.mercadopago.com/checkout/preferences/pref-1",
    );

    fakeFetch([503, {}]);
    await expect(mp.fetchStatus(ref)).rejects.toThrow();
  });

  it("keeps the amount exact", () => {
    expect(exactAmount(0.1)).toBe("0.10");
    expect(exactAmount(1214.52)).toBe("1214.52");
    expect(exactAmount(100)).toBe("100.00");
    expect(exactAmount(1.005)).toBe("1.005");
  });
});

describe("verifyWebhook", () => {
  const now = () => String(Math.floor(Date.now() / 1000));
  const sign = (
    dataId: string,
    ts: string,
    requestId = "req-1",
    key = SECRET,
  ) =>
    createHmac("sha256", key)
      .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
      .digest("hex");
  const webhook = (
    signature: string | null,
    query = "?data.id=123&type=payment",
    body: unknown = { id: 999, type: "payment", data: { id: "123" } },
  ) => {
    const headers = new Headers({ "x-request-id": "req-1" });
    if (signature) headers.set("x-signature", signature);
    return {
      headers,
      rawBody: JSON.stringify(body),
      url: new URL(
        `https://almacen.example/api/pagos/mercadopago/webhook${query}`,
      ),
    };
  };

  it("accepts a valid signature and finds the order", async () => {
    const ts = now();
    fakeFetch([200, { external_reference: ORDER }]);
    await expect(
      mp.verifyWebhook(webhook(`ts=${ts},v1=${sign("123", ts)}`)),
    ).resolves.toEqual({
      eventId: "999",
      type: "payment",
      providerRef: null,
      orderId: ORDER,
    });
    expect(calls[0]?.url).toBe("https://api.mercadopago.com/v1/payments/123");

    // Milliseconds, a lowercased alphanumeric id from the query, no body id.
    const ms = String(Date.now());
    fakeFetch();
    await expect(
      mp.verifyWebhook(
        webhook(
          ` ts=${ms} , v1=${sign("abc1", ms)}`,
          "?data.id=ABC1&type=order",
          {},
        ),
      ),
    ).resolves.toEqual({
      eventId: `order:abc1:${ms}`,
      type: "order",
      providerRef: null,
      orderId: null,
    });
    expect(calls).toHaveLength(0);
  });

  it("falls back to the body id and tolerates an unknown payment", async () => {
    const ts = now();
    fakeFetch([404, {}]);
    await expect(
      mp.verifyWebhook(
        webhook(`ts=${ts},v1=${sign("555", ts)}`, "?type=payment", {
          id: "n-1",
          data: { id: 555 },
        }),
      ),
    ).resolves.toEqual({
      eventId: "n-1",
      type: "payment",
      providerRef: null,
      orderId: null,
    });

    fakeFetch([500, {}]);
    await expect(
      mp.verifyWebhook(webhook(`ts=${ts},v1=${sign("123", ts)}`)),
    ).rejects.toThrow();
  });

  it("rejects tampered, stale, foreign or missing signatures", async () => {
    fakeFetch();
    const ts = now();
    const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
    for (const signature of [
      `ts=${ts},v1=${sign("124", ts)}`, // another payment
      `ts=${ts},v1=${sign("123", ts, "req-2")}`, // another request
      `ts=${ts},v1=${sign("123", ts, "req-1", "otro")}`, // another secret
      `ts=${stale},v1=${sign("123", stale)}`,
      `ts=${ts}`,
      `v1=${sign("123", ts)}`,
      `ts=${ts},v1=zz`,
      "basura",
      null,
    ]) {
      await expect(mp.verifyWebhook(webhook(signature))).resolves.toBeNull();
    }
    // The query id wins over the body, so a signed body id does not help.
    await expect(
      mp.verifyWebhook(
        webhook(`ts=${ts},v1=${sign("123", ts)}`, "?data.id=124&type=payment"),
      ),
    ).resolves.toBeNull();
    // Without the secret nothing is accepted.
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "");
    await expect(
      mp.verifyWebhook(webhook(`ts=${ts},v1=${sign("123", ts, "req-1", "")}`)),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
