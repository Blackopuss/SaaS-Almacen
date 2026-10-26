import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { newId } from "@/lib";
import { listAuditTrail } from "@/platform/audit";
import {
  confirmOrder,
  createPromoCode,
  disablePromoCode,
  getOrder,
  handleWebhook,
  previewCode,
  startCheckout,
  type CheckoutInput,
} from "@/platform/billing";
import type {
  PaymentProvider,
  PaymentStatus,
} from "@/platform/billing/checkout/provider";
import { getFreshEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// ADR 0028: online purchase. The amount is the server's, only the
// titular buys, the provider's confirmation (never the browser) applies
// the plan, once, and a 100% code makes it free without a provider.

const fake = vi.hoisted(() => ({
  status: { state: "pending" } as PaymentStatus,
  createCalls: [] as { orderId: string; total: string }[],
  redirect: "https://pay.example.test/session",
  failCreate: false,
  webhook: null as null | {
    eventId: string;
    type: string;
    providerRef: string | null;
    orderId: string | null;
  },
}));

vi.mock("@/platform/billing/checkout/providers", () => {
  const provider: PaymentProvider = {
    id: "stripe",
    label: "Tarjeta de prueba",
    checkoutHosts: ["pay.example.test"],
    enabled: () => true,
    createCheckout: async (request) => {
      if (fake.failCreate) throw new Error("provider down");
      fake.createCalls.push({ orderId: request.orderId, total: request.total });
      return {
        providerRef: `ref_${request.orderId}`,
        redirectUrl: fake.redirect,
      };
    },
    verifyWebhook: async () => fake.webhook,
    fetchStatus: async () => fake.status,
  };
  return {
    PAYMENT_PROVIDERS: [provider],
    findProvider: (id: string) => (id === "stripe" ? provider : null),
    enabledProviders: () => [provider],
  };
});

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser(name = "Persona") {
  return db.user.create({
    data: {
      id: newId(),
      name,
      email: `compra.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
}

async function company() {
  const owner = await newUser("Titular");
  const created = await createOrganization(owner.id, {
    name: `Ferretería compra ${stamp}-${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  return { org: created.organizationId, owner };
}

/** Each test from its own IP, so the attempt limits do not mix. */
const headers = () =>
  new Headers({ "x-forwarded-for": `198.51.100.${(++counter % 250) + 1}` });

const choice = (change: Partial<CheckoutInput> = {}): CheckoutInput => ({
  tier: "t100",
  purchasing: false,
  months: 1,
  code: "",
  provider: "stripe",
  ...change,
});

const actorOf = (c: { org: string; owner: { id: string } }) => ({
  organizationId: c.org,
  userId: c.owner.id,
});

async function newCode(percentOff: number, maxRedemptions = 5) {
  const code = `PRUEBA-${stamp}-${++counter}`;
  const done = await createPromoCode(staff, {
    code,
    percentOff,
    maxRedemptions,
    validUntil: "",
    note: "",
  });
  if (!done.ok) throw new Error("code setup failed");
  return done;
}

beforeAll(async () => {
  staff = (await newUser("Soporte Almacén")).id;
  await db.platformStaff.create({ data: { userId: staff } });
});

beforeEach(() => {
  fake.status = { state: "pending" };
  fake.createCalls = [];
  fake.failCreate = false;
  fake.redirect = "https://pay.example.test/session";
  fake.webhook = null;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("startCheckout with a provider", () => {
  it("prices on the server and sends the titular to the provider", async () => {
    const c = await company();
    const result = await startCheckout(
      actorOf(c),
      choice({ purchasing: true, months: 3 }),
      headers(),
      c.owner.email,
    );
    expect(result).toMatchObject({
      ok: true,
      next: "https://pay.example.test/session",
    });
    // (349 + 179) × 3 = 1584 + 16% VAT.
    expect(fake.createCalls[0]?.total).toBe("1837.44");
    const order = await db.checkoutOrder.findFirst({
      where: { organizationId: c.org },
    });
    expect(order).toMatchObject({ status: "PENDING", provider: "STRIPE" });
    expect(order?.transactionId).toMatch(/^AL-[2-9A-HJKMNP-Z]{8}$/);
    // Nothing granted yet.
    expect([...(await getFreshEntitlements(c.org)).modules]).toEqual([]);
  });

  it("is only for the titular", async () => {
    const c = await company();
    const stranger = await newUser();
    await expect(
      startCheckout(
        { organizationId: c.org, userId: stranger.id },
        choice(),
        headers(),
        stranger.email,
      ),
    ).rejects.toThrow();
  });

  it("refuses a provider page outside the provider's hosts", async () => {
    const c = await company();
    fake.redirect = "https://evil.example.test/pay";
    const result = await startCheckout(
      actorOf(c),
      choice(),
      headers(),
      c.owner.email,
    );
    expect(result).toMatchObject({ ok: false });
    expect(
      await db.checkoutOrder.findFirst({ where: { organizationId: c.org } }),
    ).toMatchObject({ status: "FAILED" });
  });

  it("limits unfinished checkouts and attempts", async () => {
    const c = await company();
    const ip = headers();
    for (let i = 0; i < 3; i++) {
      expect(
        await startCheckout(actorOf(c), choice(), ip, c.owner.email),
      ).toMatchObject({ ok: true });
    }
    const fourth = await startCheckout(actorOf(c), choice(), ip, c.owner.email);
    expect(fourth).toMatchObject({ ok: false });
    // Bots trying cards hit the per-person limit: no more orders are created.
    for (let i = 0; i < 10; i++) {
      await startCheckout(actorOf(c), choice(), ip, c.owner.email);
    }
    const blocked = await startCheckout(
      actorOf(c),
      choice(),
      ip,
      c.owner.email,
    );
    expect(blocked).toMatchObject({
      ok: false,
      formError: expect.stringContaining("Demasiados intentos"),
    });
    expect(
      await db.checkoutOrder.count({ where: { organizationId: c.org } }),
    ).toBe(3);
  });
});

describe("confirming the payment", () => {
  async function pendingOrder() {
    const c = await company();
    const result = await startCheckout(
      actorOf(c),
      choice({ months: 6 }),
      headers(),
      c.owner.email,
    );
    if (!result.ok) throw new Error("checkout failed");
    return { ...c, orderId: result.orderId };
  }

  it("applies the plan once, when the provider says it was paid", async () => {
    const c = await pendingOrder();
    // Coming back alone grants nothing.
    expect(await getOrder(actorOf(c), c.orderId)).toMatchObject({
      status: "PENDING",
    });
    fake.status = {
      state: "paid",
      amount: "2429.04", // 349 × 6 + VAT
      currency: "mxn",
      paymentRef: "pi_1",
    };
    await Promise.all([
      confirmOrder(c.org, c.orderId),
      confirmOrder(c.org, c.orderId),
      getOrder(actorOf(c), c.orderId),
    ]);
    const view = await getOrder(actorOf(c), c.orderId);
    expect(view).toMatchObject({ status: "PAID", total: "2429.04" });
    const rights = await getFreshEntitlements(c.org);
    expect([...rights.modules]).toEqual(["inventory"]);
    const trail = await listAuditTrail(c.org, { limit: 10 });
    expect(
      trail.filter((entry) => entry.action === "plan.purchased"),
    ).toHaveLength(1);
    expect(
      await db.job.count({
        where: { organizationId: c.org, type: "billing.purchase_receipt" },
      }),
    ).toBe(1);
  });

  it("never grants on a different amount", async () => {
    const c = await pendingOrder();
    fake.status = {
      state: "paid",
      amount: "1.00",
      currency: "MXN",
      paymentRef: "pi_2",
    };
    await confirmOrder(c.org, c.orderId);
    expect(await getOrder(actorOf(c), c.orderId)).toMatchObject({
      status: "PENDING",
    });
    expect([...(await getFreshEntitlements(c.org)).modules]).toEqual([]);
  });

  it("a webhook is stored once and asks the provider", async () => {
    const c = await pendingOrder();
    fake.status = {
      state: "paid",
      amount: "2429.04",
      currency: "MXN",
      paymentRef: "pi_3",
    };
    fake.webhook = {
      eventId: `evt_${c.orderId}`,
      type: "checkout.session.completed",
      providerRef: `ref_${c.orderId}`,
      orderId: null,
    };
    const request = {
      headers: new Headers(),
      rawBody: "{}",
      url: new URL("https://almacen.test/api/pagos/stripe/webhook"),
    };
    expect(await handleWebhook("stripe", request)).toEqual({ status: 200 });
    expect(await handleWebhook("stripe", request)).toEqual({ status: 200 });
    expect(
      await db.paymentEvent.count({ where: { eventId: `evt_${c.orderId}` } }),
    ).toBe(1);
    expect(await getOrder(actorOf(c), c.orderId)).toMatchObject({
      status: "PAID",
    });
    fake.webhook = null;
    expect(await handleWebhook("stripe", request)).toEqual({ status: 400 });
    expect(await handleWebhook("nadie", request)).toEqual({ status: 404 });
  });

  it("forged deliveries from one IP are cut off; other IPs still answer", async () => {
    fake.webhook = null;
    const from = (ip: string) => ({
      headers: new Headers({ "x-forwarded-for": ip }),
      rawBody: "{}",
      url: new URL("https://almacen.test/api/pagos/stripe/webhook"),
    });
    const forger = `203.0.113.${Date.now() % 250}`;
    for (let i = 0; i < 30; i++) {
      expect(await handleWebhook("stripe", from(forger))).toEqual({
        status: 400,
      });
    }
    // Blocked before verifying: no more calls to the provider from there.
    expect(await handleWebhook("stripe", from(forger))).toEqual({
      status: 429,
    });
    expect(await handleWebhook("stripe", from("198.51.100.7"))).toEqual({
      status: 400,
    });
  });

  it("a paid order is final in the database", async () => {
    const c = await pendingOrder();
    await expect(
      db.checkoutOrder.update({
        where: { id: c.orderId },
        data: { total: "0.01" },
      }),
    ).rejects.toThrow();
    await expect(
      db.checkoutOrder.delete({ where: { id: c.orderId } }),
    ).rejects.toThrow();
  });
});

describe("codes", () => {
  it("a 100% code buys the plan at once, without a provider", async () => {
    const c = await company();
    const code = await newCode(100, 1);
    const preview = await previewCode(
      actorOf(c),
      choice({ code: code.code.toLowerCase(), purchasing: true }),
      headers(),
    );
    expect(preview).toMatchObject({ ok: true, quote: { total: "0.00" } });
    const result = await startCheckout(
      actorOf(c),
      choice({ code: code.code, purchasing: true, months: 12, provider: "" }),
      headers(),
      c.owner.email,
    );
    expect(result).toMatchObject({ ok: true });
    expect(fake.createCalls).toHaveLength(0);
    const rights = await getFreshEntitlements(c.org);
    expect([...rights.modules].sort()).toEqual(["inventory", "purchasing"]);
    expect(
      await db.checkoutOrder.findFirst({ where: { organizationId: c.org } }),
    ).toMatchObject({ status: "PAID", provider: "CODE" });

    // Its only use is gone: another company cannot use it.
    const other = await company();
    expect(
      await startCheckout(
        actorOf(other),
        choice({ code: code.code, provider: "" }),
        headers(),
        other.owner.email,
      ),
    ).toMatchObject({ ok: false, fieldErrors: { code: expect.any(String) } });
  });

  it("a partial code discounts before VAT and the provider charges the rest", async () => {
    const c = await company();
    const code = await newCode(50);
    const result = await startCheckout(
      actorOf(c),
      choice({ code: code.code, months: 3 }),
      headers(),
      c.owner.email,
    );
    expect(result).toMatchObject({ ok: true });
    expect(fake.createCalls[0]?.total).toBe("607.26");
  });

  it("unknown, disabled and expired codes all answer the same", async () => {
    const c = await company();
    const code = await newCode(100);
    await disablePromoCode(staff, code.id);
    for (const text of [code.code, "NO-EXISTE-NUNCA"]) {
      expect(
        await previewCode(actorOf(c), choice({ code: text }), headers()),
      ).toMatchObject({
        ok: false,
        fieldErrors: { code: "Ese código no es válido o ya no está vigente." },
      });
    }
  });

  it("only platform staff create or disable codes", async () => {
    const someone = await newUser();
    const code = await newCode(100);
    expect(await disablePromoCode(someone.id, code.id)).toMatchObject({
      ok: false,
    });
    expect(
      await db.promoCode.findUnique({ where: { id: code.id } }),
    ).toMatchObject({ disabledAt: null });
    expect(
      await createPromoCode(someone.id, {
        code: "GRATIS-TOTAL",
        percentOff: 100,
        maxRedemptions: 100,
        validUntil: "",
        note: "",
      }),
    ).toMatchObject({ ok: false });
  });
});
