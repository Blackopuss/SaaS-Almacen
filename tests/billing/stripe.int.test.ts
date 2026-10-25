import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stripeProvider } from "@/platform/billing/checkout/stripe";

const SECRET = "whsec_prueba";

type Captured = { url: string; init: RequestInit };

function stubFetch(status: number, body: unknown): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return calls;
}

function request(total: string, expiresAt = new Date(Date.now() + 3600_000)) {
  return {
    orderId: "0190a000-0000-7000-8000-000000000001",
    transactionId: "AL-7F3K9Q2M",
    description: "Almacén · 1,000 productos · 3 meses",
    total,
    currency: "MXN" as const,
    customerEmail: "titular@example.test",
    returnUrl: "https://almacen.test/pago/estado",
    cancelUrl: "https://almacen.test/pago/cancelado",
    expiresAt,
  };
}

const session = {
  id: "cs_test_1",
  url: "https://checkout.stripe.com/c/pay/cs_test_1",
};

function sign(
  body: string,
  t = Math.floor(Date.now() / 1000),
  secret = SECRET,
) {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return { t, v1, header: `t=${t},v1=${v1}` };
}

function webhook(body: string, header: string | null) {
  const headers = new Headers();
  if (header !== null) headers.set("Stripe-Signature", header);
  return {
    headers,
    rawBody: body,
    url: new URL("https://almacen.test/api/pagos/stripe/webhook"),
  };
}

const eventBody = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_1", metadata: { orderId: "orden-1" } } },
});

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_clave");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("stripe: configuración", () => {
  it("solo se ofrece con ambas claves", () => {
    expect(stripeProvider.enabled()).toBe(true);
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(stripeProvider.enabled()).toBe(false);
  });
});

describe("stripe: createCheckout", () => {
  it("manda la sesión con importe exacto en centavos y cabeceras", async () => {
    const calls = stubFetch(200, session);
    const result = await stripeProvider.createCheckout(request("1214.52"));
    expect(result).toEqual({
      providerRef: "cs_test_1",
      redirectUrl: session.url,
    });

    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_clave");
    expect(headers["Idempotency-Key"]).toBe(request("1").orderId);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("mode")).toBe("payment");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("121452");
    expect(body.get("line_items[0][price_data][currency]")).toBe("mxn");
    expect(body.get("line_items[0][price_data][product_data][name]")).toBe(
      "Almacén · 1,000 productos · 3 meses",
    );
    expect(body.get("client_reference_id")).toBe(request("1").orderId);
    expect(body.get("metadata[orderId]")).toBe(request("1").orderId);
    expect(body.get("metadata[transactionId]")).toBe("AL-7F3K9Q2M");
    expect(body.get("customer_email")).toBe("titular@example.test");
    expect(body.get("success_url")).toBe("https://almacen.test/pago/estado");
    expect(body.get("cancel_url")).toBe("https://almacen.test/pago/cancelado");
    expect(body.get("locale")).toBe("es-419");
  });

  it("0.10 son 10 centavos y una fracción de centavo se rechaza", async () => {
    const calls = stubFetch(200, session);
    await stripeProvider.createCheckout(request("0.10"));
    const body = new URLSearchParams(calls[0]!.init.body as string);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("10");
    await expect(
      stripeProvider.createCheckout(request("1.005")),
    ).rejects.toThrow();
  });

  it("ajusta el vencimiento a lo que Stripe acepta (30 min a 24 h)", async () => {
    const calls = stubFetch(200, session);
    const now = Math.floor(Date.now() / 1000);
    await stripeProvider.createCheckout(
      request("1", new Date(Date.now() + 60_000)),
    );
    await stripeProvider.createCheckout(
      request("1", new Date(Date.now() + 3 * 86400_000)),
    );
    const [soon, late] = calls.map((c) =>
      Number(new URLSearchParams(c.init.body as string).get("expires_at")),
    );
    expect(soon).toBeGreaterThanOrEqual(now + 30 * 60);
    expect(late).toBeLessThanOrEqual(now + 24 * 3600);
  });

  it("rechaza una dirección que no es de checkout.stripe.com por https", async () => {
    for (const url of [
      "http://checkout.stripe.com/c/pay/x",
      "https://checkout.stripe.com.evil.test/c",
      "https://evil.test/c",
      null,
    ]) {
      stubFetch(200, { id: "cs_x", url });
      await expect(
        stripeProvider.createCheckout(request("1")),
      ).rejects.toThrow();
    }
  });

  it("una respuesta de error lanza", async () => {
    stubFetch(400, { error: { type: "invalid_request_error", code: "x" } });
    await expect(stripeProvider.createCheckout(request("1"))).rejects.toThrow();
  });
});

describe("stripe: verifyWebhook", () => {
  it("acepta una firma válida", async () => {
    const result = await stripeProvider.verifyWebhook(
      webhook(eventBody, sign(eventBody).header),
    );
    expect(result).toEqual({
      eventId: "evt_1",
      type: "checkout.session.completed",
      providerRef: "cs_test_1",
      orderId: "orden-1",
    });
  });

  it("acepta cuando una de varias v1 coincide", async () => {
    const { t, v1 } = sign(eventBody);
    const header = `t=${t},v1=${"0".repeat(64)},v0=abc,v1=${v1}`;
    expect(
      await stripeProvider.verifyWebhook(webhook(eventBody, header)),
    ).not.toBeNull();
  });

  it("los eventos que no son de checkout no traen sesión", async () => {
    const body = JSON.stringify({
      id: "evt_2",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_1", metadata: { orderId: "orden-1" } } },
    });
    expect(
      await stripeProvider.verifyWebhook(webhook(body, sign(body).header)),
    ).toEqual({
      eventId: "evt_2",
      type: "payment_intent.succeeded",
      providerRef: null,
      orderId: "orden-1",
    });
  });

  it("rechaza cuerpo alterado, otro secreto, fecha vieja o sin cabecera", async () => {
    const { header } = sign(eventBody);
    const cases = [
      webhook(eventBody.replace("orden-1", "orden-2"), header),
      webhook(eventBody, sign(eventBody, undefined, "otro").header),
      webhook(
        eventBody,
        sign(eventBody, Math.floor(Date.now() / 1000) - 301).header,
      ),
      webhook(
        eventBody,
        sign(eventBody, Math.floor(Date.now() / 1000) + 301).header,
      ),
      webhook(eventBody, null),
      webhook(eventBody, "basura"),
      webhook(eventBody, `t=${Math.floor(Date.now() / 1000)},v1=zz`),
      webhook("no es json", sign("no es json").header),
    ];
    for (const item of cases) {
      expect(await stripeProvider.verifyWebhook(item)).toBeNull();
    }
  });
});

describe("stripe: fetchStatus", () => {
  const ref = { providerRef: "cs_test_1", orderId: "orden-1" };

  it("pagada: importe exacto, moneda en mayúsculas y id del pago", async () => {
    const calls = stubFetch(200, {
      status: "complete",
      payment_status: "paid",
      amount_total: 121452,
      currency: "mxn",
      payment_intent: "pi_1",
    });
    expect(await stripeProvider.fetchStatus(ref)).toEqual({
      state: "paid",
      amount: "1214.52",
      currency: "MXN",
      paymentRef: "pi_1",
    });
    expect(calls[0]!.url).toBe(
      "https://api.stripe.com/v1/checkout/sessions/cs_test_1",
    );
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("abierta y OXXO sin pagar quedan pendientes; vencida es expired", async () => {
    stubFetch(200, { status: "open", payment_status: "unpaid" });
    expect(await stripeProvider.fetchStatus(ref)).toEqual({ state: "pending" });
    stubFetch(200, {
      status: "complete",
      payment_status: "unpaid",
      payment_intent: "pi_2",
    });
    expect(await stripeProvider.fetchStatus(ref)).toEqual({ state: "pending" });
    stubFetch(200, { status: "expired", payment_status: "unpaid" });
    expect(await stripeProvider.fetchStatus(ref)).toEqual({ state: "expired" });
  });

  it("una respuesta de error lanza", async () => {
    stubFetch(500, { error: { type: "api_error" } });
    await expect(stripeProvider.fetchStatus(ref)).rejects.toThrow();
  });
});
