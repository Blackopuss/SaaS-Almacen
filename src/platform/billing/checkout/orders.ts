import "server-only";

import { createHash, randomInt } from "node:crypto";

import { z } from "zod";

import { dec, formatDecimal, log, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import {
  blockedFor,
  clientIp,
  recordAttempt,
  reserveAttempt,
  tooManyAttemptsMessage,
} from "@/platform/auth";
import { assertOwnerAction } from "@/platform/authorization";
import { sendEmail, planPurchaseEmail } from "@/platform/email";
import {
  ensureQuotaRows,
  invalidateEntitlements,
} from "@/platform/entitlements";
import { enqueueJob, type JobHandlers } from "@/platform/jobs";
import { LOCKING_TRANSACTION, db, forOrganization } from "@/server";

import {
  PLAN_TIERS,
  PURCHASE_MONTHS,
  findTier,
  isPurchaseMonths,
  planText,
  quote,
  type PlanTier,
  type PurchaseMonths,
  type Quote,
  type SoldModule,
} from "../prices";
import { setEntitlement } from "../provisioning";
import { extendValidity } from "../validity";
import { CODE_REJECTED, findUsableCode, redeemCode } from "./codes";
import type { PaymentProvider, ProviderId, WebhookRequest } from "./provider";
import { enabledProviders, findProvider } from "./providers";
import { CONTACT_EMAIL, REFUND_TERMS } from "./refunds";

/**
 * Online purchase of a plan (ADR 0028). Only the titular buys, for the
 * whole company: the people they invited use the same plan. The server
 * fixes every amount; the provider's hosted page takes the payment (we
 * never see a card) and the plan is applied only when the provider itself
 * confirms that exactly that amount was paid — by a signed webhook or by
 * asking it when the customer comes back. Coming back alone grants
 * nothing. A code of 100% makes the purchase free without a provider.
 *
 * Against card testing (bots trying stolen cards through our checkout):
 * only a signed-in titular (verified email, two-step verification) can
 * start a checkout, the attempts per person, company and IP are limited
 * before anything is created, a company has few unfinished checkouts at a
 * time, and the provider's own fraud screening sees every attempt.
 */

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
type Actor = { organizationId: string; userId: string };

const PERMISSION = "platform.subscription.create" as const;
const PROVIDER_ENUM = {
  stripe: "STRIPE",
  paypal: "PAYPAL",
  mercadopago: "MERCADOPAGO",
} as const satisfies Record<ProviderId, string>;
type ProviderEnum = (typeof PROVIDER_ENUM)[ProviderId];

/** A checkout can be paid for this long (OXXO vouchers take days). */
const ORDER_LIFETIME_MS = 72 * 3_600_000;
/**
 * Checkouts a company may open within PENDING_WINDOW_MS. A checkout left
 * on the provider's page stays PENDING until the provider expires it (about
 * a day), so only recent ones count: abandoned ones stop blocking soon,
 * and the attempt limits keep stopping bots.
 */
const MAX_PENDING = 3;
const PENDING_WINDOW_MS = 3_600_000;
export const RECEIPT_JOB_TYPE = "billing.purchase_receipt";

const hourly = (max: number) => ({
  max,
  windowSeconds: 3600,
  blockSeconds: 3600,
});
const ipHash = (ip: string) =>
  createHash("sha256").update(ip).digest("hex").slice(0, 32);

/**
 * Webhook deliveries whose signature did not check out, per IP (PIL-05):
 * a real provider never fails it, while each forged PayPal delivery costs a
 * call to PayPal with our credentials. Valid deliveries never count.
 */
const webhookIpKey = (headers: Headers) => ({
  key: `webhook:ip:${ipHash(clientIp(headers))}`,
  rule: hourly(30),
});

/** Every start of a checkout or try of a code counts here first. */
function attemptKeys(actor: Actor, headers: Headers) {
  return [
    { key: `checkout:user:${actor.userId}`, rule: hourly(10) },
    { key: `checkout:org:${actor.organizationId}`, rule: hourly(20) },
    { key: `checkout:ip:${ipHash(clientIp(headers))}`, rule: hourly(40) },
  ];
}

const baseUrl = () => (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
export const orderPath = (orderId: string) =>
  `/configuracion/plan/compra/${encodeURIComponent(orderId)}`;

/** "AL-7F3K9Q2M": no 0/O or 1/I/L, easy to read over the phone. */
function newTransactionId(): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let id = "AL-";
  for (let i = 0; i < 8; i++) id += alphabet[randomInt(alphabet.length)];
  return id;
}

export const formatMxn = (amount: { toString(): string } | string) =>
  `$${formatDecimal(dec(amount.toString()), { minScale: 2, maxScale: 2 })}`;

const parseModules = (text: string): SoldModule[] =>
  text
    .split(",")
    .filter((m): m is SoldModule => m === "inventory" || m === "purchasing");

// ── The plan the company has now ────────────────────────────────────────

type CurrentPlan = {
  tierId: string | null;
  productLimit: number | null;
  purchasing: boolean;
  /** Null = no end date (granted by staff). */
  validUntil: Date | null;
  live: boolean;
};

async function readPlan(
  client: Pick<Tx, "entitlement">,
  organizationId: string,
  now: Date,
): Promise<CurrentPlan | null> {
  const rows = await client.entitlement.findMany({
    where: { organizationId },
    select: {
      kind: true,
      key: true,
      value: true,
      validFrom: true,
      validUntil: true,
    },
  });
  const products = rows.find(
    (row) => row.kind === "LIMIT" && row.key === "active_products",
  );
  if (!products) return null;
  const end = products.validUntil;
  // The modules of the plan end when it ends; one removed earlier does not.
  const purchasing = rows.some(
    (row) =>
      row.kind === "MODULE" &&
      row.key === "purchasing" &&
      (row.validUntil?.getTime() ?? null) === (end?.getTime() ?? null),
  );
  return {
    tierId:
      PLAN_TIERS.find((tier) => tier.productLimit === products.value)?.id ??
      null,
    productLimit: products.value,
    purchasing,
    validUntil: end,
    live: products.validFrom <= now && (end === null || end > now),
  };
}

/** Why this purchase cannot be made over the current plan, if it cannot. */
function planConflict(
  plan: CurrentPlan | null,
  tier: PlanTier,
  purchasing: boolean,
): string | null {
  if (!plan || !plan.live) return null;
  if (plan.validUntil === null) {
    return "Tu plan no tiene fecha de término: no necesitas comprarlo.";
  }
  if (plan.tierId !== tier.id || plan.purchasing !== purchasing) {
    // shortcut: changing tier or modules mid-period needs prorating (BIL-08/09); until then only renewals of the same plan.
    return `Mientras tu plan esté vigente puedes renovarlo igual. Para cambiar de nivel o de módulos escríbenos a ${CONTACT_EMAIL}.`;
  }
  return null;
}

// ── What the titular can choose ─────────────────────────────────────────

export type CheckoutOptions = {
  tiers: {
    id: string;
    productLimit: number;
    users: number;
    /** Quote of each length, without and with Compras. */
    quotes: {
      months: PurchaseMonths;
      inventory: Quote;
      withPurchasing: Quote;
    }[];
  }[];
  months: readonly PurchaseMonths[];
  providers: { id: ProviderId; label: string }[];
  current: CurrentPlan | null;
  refundTerms: readonly string[];
};

export async function getCheckoutOptions(
  actor: Actor,
): Promise<CheckoutOptions> {
  await assertOwnerAction(actor.organizationId, actor.userId, PERMISSION);
  return {
    tiers: PLAN_TIERS.map((tier) => ({
      id: tier.id,
      productLimit: tier.productLimit,
      users: tier.users,
      quotes: PURCHASE_MONTHS.map((months) => ({
        months,
        inventory: quote(tier, [], months),
        withPurchasing: quote(tier, ["purchasing"], months),
      })),
    })),
    months: PURCHASE_MONTHS,
    providers: enabledProviders().map(({ id, label }) => ({ id, label })),
    current: await readPlan(db, actor.organizationId, new Date()),
    refundTerms: REFUND_TERMS,
  };
}

// ── Starting a checkout ─────────────────────────────────────────────────

const choiceSchema = z.object({
  tier: z.string().transform((value, context) => {
    const tier = findTier(value);
    if (!tier) {
      context.addIssue({ code: "custom", message: "Elige un plan." });
      return z.NEVER;
    }
    return tier;
  }),
  purchasing: z.boolean(),
  months: z.coerce.number().refine(isPurchaseMonths, {
    message: "Elige 1, 3, 6 o 12 meses.",
  }) as z.ZodType<PurchaseMonths>,
  code: z
    .string()
    .trim()
    .max(60)
    .transform((value) => value || null),
});

export type CheckoutInput = {
  tier: string;
  purchasing: boolean;
  months: number | string;
  code: string;
  /** Provider id; ignored when a code makes it free. */
  provider: string;
};
export type CheckoutField = "tier" | "months" | "code" | "provider";
export type CheckoutResult =
  | {
      ok: true;
      /** Where to send the browser: the provider's page or our status page. */
      next: string;
      orderId: string;
    }
  | {
      ok: false;
      fieldErrors: Partial<Record<CheckoutField, string>>;
      formError?: string;
    };

type Fail = Extract<CheckoutResult, { ok: false }>;
class Rejected extends Error {
  constructor(readonly result: Fail) {
    super("rejected");
  }
}
const fail = (
  formError: string | undefined,
  fieldErrors: Fail["fieldErrors"] = {},
): Fail => ({ ok: false, fieldErrors, formError });

function parseChoice(input: CheckoutInput) {
  const parsed = choiceSchema.safeParse({
    tier: String(input.tier ?? ""),
    purchasing: input.purchasing === true,
    months: input.months,
    code: String(input.code ?? ""),
  });
  if (parsed.success) return { ok: true as const, data: parsed.data };
  const fieldErrors: Fail["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    fieldErrors[issue.path[0] as CheckoutField] ??= issue.message;
  }
  return { ok: false as const, result: fail(undefined, fieldErrors) };
}

/** Locks the company: one checkout decision at a time per company. */
async function lockCompany(tx: Tx, organizationId: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw new Rejected(fail("Esa empresa no existe."));
}

/**
 * Shows what a code would discount, without creating anything. Counts as
 * an attempt, like starting a checkout: trying codes is limited.
 */
export async function previewCode(
  actor: Actor,
  input: Omit<CheckoutInput, "provider">,
  headers: Headers,
): Promise<
  { ok: true; code: string; percentOff: number; quote: Quote } | Fail
> {
  await assertOwnerAction(actor.organizationId, actor.userId, PERMISSION);
  const choice = parseChoice({ ...input, provider: "" });
  if (!choice.ok) return choice.result;
  const { tier, purchasing, months, code } = choice.data;
  if (!code) return fail(undefined, { code: "Escribe el código." });
  const wait = await reserveAttempt(attemptKeys(actor, headers));
  if (wait > 0) return fail(tooManyAttemptsMessage(wait));
  const usable = await findUsableCode(db, code);
  if (!usable) return fail(undefined, { code: CODE_REJECTED });
  return {
    ok: true,
    code: usable.code,
    percentOff: usable.percentOff,
    quote: quote(
      tier,
      purchasing ? ["purchasing"] : [],
      months,
      usable.percentOff,
    ),
  };
}

/**
 * Starts a purchase: checks who buys and what, prices it, and either
 * applies it at once (a code of 100%) or opens the provider's checkout.
 */
export async function startCheckout(
  actor: Actor,
  input: CheckoutInput,
  headers: Headers,
  ownerEmail: string,
): Promise<CheckoutResult> {
  await assertOwnerAction(actor.organizationId, actor.userId, PERMISSION);
  const choice = parseChoice(input);
  if (!choice.ok) return choice.result;
  const { tier, purchasing, months, code } = choice.data;

  const wait = await reserveAttempt(attemptKeys(actor, headers));
  if (wait > 0) return fail(tooManyAttemptsMessage(wait));

  const usable = code ? await findUsableCode(db, code) : null;
  if (code && !usable) return fail(undefined, { code: CODE_REJECTED });
  const modules: SoldModule[] = purchasing ? ["purchasing"] : [];
  const price = quote(tier, modules, months, usable?.percentOff ?? 0);
  const free = dec(price.total).isZero();

  let provider: PaymentProvider | null = null;
  if (!free) {
    provider = findProvider(String(input.provider ?? ""));
    if (!provider || !provider.enabled()) {
      return fail(undefined, { provider: "Elige cómo quieres pagar." });
    }
  }

  const now = new Date();
  const orderId = newId();
  const transactionId = newTransactionId();
  try {
    await db.$transaction(async (tx) => {
      await lockCompany(tx, actor.organizationId);
      const conflict = planConflict(
        await readPlan(tx, actor.organizationId, now),
        tier,
        purchasing,
      );
      if (conflict) throw new Rejected(fail(conflict));
      const pending = await tx.checkoutOrder.count({
        where: {
          organizationId: actor.organizationId,
          status: "PENDING",
          createdAt: { gt: new Date(now.getTime() - PENDING_WINDOW_MS) },
        },
      });
      if (pending >= MAX_PENDING) {
        throw new Rejected(
          fail(
            "Abriste varios pagos en la última hora sin terminarlos. Termina uno o inténtalo de nuevo en un rato.",
          ),
        );
      }
      await tx.checkoutOrder.create({
        data: {
          id: orderId,
          organizationId: actor.organizationId,
          transactionId,
          userId: actor.userId,
          tier: tier.id,
          productLimit: tier.productLimit,
          includedUsers: tier.users,
          modules: ["inventory", ...modules].join(","),
          months,
          subtotal: price.subtotal,
          discount: price.discount,
          tax: price.tax,
          total: price.total,
          provider: free ? "CODE" : PROVIDER_ENUM[provider!.id],
          promoCodeId: usable?.id ?? null,
          expiresAt: new Date(now.getTime() + ORDER_LIFETIME_MS),
        },
      });
      if (free) {
        // The code's last use may have just been taken by someone else.
        if (!(await redeemCode(tx, usable!.id))) {
          throw new Rejected(fail(undefined, { code: CODE_REJECTED }));
        }
        await applyPurchase(tx, actor.organizationId, orderId, null, now);
      }
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
  if (free) {
    invalidateEntitlements(actor.organizationId);
    return { ok: true, next: orderPath(orderId), orderId };
  }

  const base = baseUrl();
  try {
    const session = await provider!.createCheckout({
      orderId,
      transactionId,
      description: `Almacén · ${planText(tier.productLimit, modules)} · ${months} ${months === 1 ? "mes" : "meses"}`,
      total: price.total,
      currency: "MXN",
      customerEmail: ownerEmail,
      returnUrl: `${base}${orderPath(orderId)}`,
      cancelUrl: `${base}/configuracion/plan/comprar?cancelada=1`,
      expiresAt: new Date(now.getTime() + ORDER_LIFETIME_MS),
    });
    const target = new URL(session.redirectUrl);
    if (
      target.protocol !== "https:" ||
      !provider!.checkoutHosts.includes(target.hostname)
    ) {
      throw new Error(`unexpected checkout host ${target.hostname}`);
    }
    await forOrganization(actor.organizationId).checkoutOrder.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { providerRef: session.providerRef },
    });
    return { ok: true, next: target.toString(), orderId };
  } catch (error) {
    log.error("checkout_open_failed", {
      provider: provider!.id,
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    await forOrganization(actor.organizationId).checkoutOrder.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: "FAILED" },
    });
    return fail(
      `No pudimos abrir el pago con ${provider!.label}. Intenta de nuevo o elige otra forma de pago.`,
    );
  }
}

// ── Applying a paid order ───────────────────────────────────────────────

/**
 * Applies a paid order inside the caller's transaction, with the company
 * locked: the plan of the order from the end of the current one (or from
 * today when it already ended), the order marked PAID, the audit event and
 * the receipt email queued. Does nothing when it is no longer PENDING.
 */
async function applyPurchase(
  tx: Tx,
  organizationId: string,
  orderId: string,
  paymentRef: string | null,
  now: Date,
): Promise<boolean> {
  const order = await tx.checkoutOrder.findFirst({
    where: { organizationId, id: orderId },
  });
  if (!order || order.status !== "PENDING") return false;
  const modules = parseModules(order.modules);
  const plan = await readPlan(tx, organizationId, now);
  const before = plan?.validUntil ?? null;
  const after = extendValidity(before ?? now, now, order.months);

  await ensureQuotaRows(tx, organizationId);
  await setEntitlement(
    tx,
    organizationId,
    "LIMIT",
    "active_products",
    order.productLimit,
    after,
    now,
  );
  await setEntitlement(
    tx,
    organizationId,
    "LIMIT",
    "users",
    order.includedUsers,
    after,
    now,
  );
  for (const moduleId of modules) {
    await setEntitlement(
      tx,
      organizationId,
      "MODULE",
      moduleId,
      null,
      after,
      now,
    );
  }
  await tx.entitlement.updateMany({
    where: {
      organizationId,
      kind: "MODULE",
      key: { notIn: modules },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    data: { validUntil: now },
  });
  await tx.checkoutOrder.updateMany({
    where: { organizationId, id: orderId, status: "PENDING" },
    data: {
      status: "PAID",
      paidAt: now,
      paymentRef,
      validUntilBefore: before,
      validUntilAfter: after,
    },
  });
  await recordAuditEvent(tx, {
    organizationId,
    actorUserId: order.userId,
    action: "plan.purchased",
    target: { type: "checkout_order", id: orderId },
    metadata: {
      transactionId: order.transactionId,
      tier: order.tier,
      modules,
      months: order.months,
      total: order.total.toFixed(2),
      currency: order.currency,
      provider: order.provider,
      withCode: order.promoCodeId !== null,
      validUntilBefore: before ? before.toISOString() : null,
      validUntilAfter: after.toISOString(),
    },
  });
  // Same connection; the tenant client type only differs by its extension.
  await enqueueJob(
    tx as unknown as Parameters<typeof enqueueJob>[0],
    organizationId,
    {
      type: RECEIPT_JOB_TYPE,
      payload: { orderId },
      createdByUserId: order.userId,
    },
  );
  return true;
}

/**
 * Asks the provider for the authoritative state of an order and applies
 * it. Safe to call any number of times and at once (webhook and the
 * customer coming back): the company lock lets one of them apply it.
 */
export async function confirmOrder(
  organizationId: string,
  orderId: string,
): Promise<void> {
  const order = await forOrganization(organizationId).checkoutOrder.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      provider: true,
      providerRef: true,
      total: true,
      currency: true,
      promoCodeId: true,
      expiresAt: true,
    },
  });
  if (!order || order.status !== "PENDING" || order.provider === "CODE") {
    return;
  }
  const scoped = forOrganization(organizationId).checkoutOrder;
  if (!order.providerRef) {
    // The checkout never opened; past its life it is just expired.
    if (order.expiresAt <= new Date()) {
      await scoped.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
    }
    return;
  }
  const provider = findProvider(order.provider.toLowerCase());
  if (!provider) return;
  const status = await provider.fetchStatus({
    providerRef: order.providerRef,
    orderId,
  });

  if (status.state === "paid") {
    const exact =
      /^\d+(\.\d{1,2})?$/.test(status.amount) &&
      dec(status.amount).equals(order.total) &&
      status.currency.toUpperCase() === order.currency;
    if (!exact) {
      // Never grant on a different amount: a person reviews it.
      log.error("checkout_amount_mismatch", {
        orderId,
        provider: provider.id,
        expected: order.total.toFixed(2),
        received: status.amount,
        currency: status.currency,
      });
      return;
    }
    const applied = await db.$transaction(async (tx) => {
      await lockCompany(tx, organizationId);
      const done = await applyPurchase(
        tx,
        organizationId,
        orderId,
        status.paymentRef,
        new Date(),
      );
      // Already charged: the use counts if there is room; never refused.
      if (done && order.promoCodeId) await redeemCode(tx, order.promoCodeId);
      return done;
    }, LOCKING_TRANSACTION);
    if (applied) invalidateEntitlements(organizationId);
    return;
  }
  if (status.state === "failed" || status.state === "expired") {
    await scoped.updateMany({
      where: { id: orderId, status: "PENDING" },
      data: { status: status.state === "failed" ? "FAILED" : "EXPIRED" },
    });
  }
}

// ── Webhooks ────────────────────────────────────────────────────────────

/**
 * A provider's webhook: verified, stored before answering (a repeated
 * delivery is recognised by its event id) and turned into a question to
 * the provider about the order. Answers 2xx only once it was handled, so
 * the provider retries otherwise.
 */
export async function handleWebhook(
  providerId: string,
  request: WebhookRequest,
): Promise<{ status: number }> {
  const provider = findProvider(providerId);
  if (!provider || !provider.enabled()) return { status: 404 };
  const ipKey = webhookIpKey(request.headers);
  if ((await blockedFor([ipKey])) > 0) return { status: 429 };
  let event;
  try {
    event = await provider.verifyWebhook(request);
  } catch (error) {
    log.error("payment_webhook_verify_failed", {
      provider: provider.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 500 };
  }
  if (!event) {
    log.warn("payment_webhook_rejected", { provider: provider.id });
    await recordAttempt([ipKey]);
    return { status: 400 };
  }
  const providerEnum: ProviderEnum = PROVIDER_ENUM[provider.id];
  // Finding the company of an order is the one lookup across companies.
  const order = event.providerRef
    ? await db.checkoutOrder.findFirst({
        where: { provider: providerEnum, providerRef: event.providerRef },
        select: { id: true, organizationId: true },
      })
    : event.orderId && /^[0-9a-f-]{36}$/.test(event.orderId)
      ? await db.checkoutOrder.findFirst({
          where: { provider: providerEnum, id: event.orderId },
          select: { id: true, organizationId: true },
        })
      : null;

  const key = {
    provider: provider.id,
    eventId: event.eventId.slice(0, 255),
  };
  const seen = await db.paymentEvent.findUnique({
    where: { provider_eventId: key },
    select: { id: true, processedAt: true },
  });
  if (seen?.processedAt) return { status: 200 };
  const eventRowId = seen?.id ?? newId();
  if (!seen) {
    try {
      await db.paymentEvent.create({
        data: {
          id: eventRowId,
          ...key,
          type: event.type.slice(0, 100),
          orderId: order?.id ?? null,
        },
      });
    } catch (error) {
      // The same delivery arrived twice at once: the other one handles it.
      if ((error as { code?: string }).code === "P2002") return { status: 200 };
      throw error;
    }
  }
  if (order) await confirmOrder(order.organizationId, order.id);
  await db.paymentEvent.update({
    where: { id: eventRowId },
    data: { processedAt: new Date() },
  });
  return { status: 200 };
}

// ── What the titular sees ───────────────────────────────────────────────

export type OrderView = {
  id: string;
  transactionId: string;
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED";
  planText: string;
  months: number;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  provider: "STRIPE" | "PAYPAL" | "MERCADOPAGO" | "CODE";
  createdAt: Date;
  paidAt: Date | null;
  validUntil: Date | null;
};

const ORDER_SELECT = {
  id: true,
  transactionId: true,
  status: true,
  productLimit: true,
  modules: true,
  months: true,
  subtotal: true,
  discount: true,
  tax: true,
  total: true,
  provider: true,
  createdAt: true,
  paidAt: true,
  validUntilAfter: true,
} as const;

function toView(row: {
  id: string;
  transactionId: string;
  status: OrderView["status"];
  productLimit: number;
  modules: string;
  months: number;
  subtotal: { toFixed(n: number): string };
  discount: { toFixed(n: number): string };
  tax: { toFixed(n: number): string };
  total: { toFixed(n: number): string };
  provider: OrderView["provider"];
  createdAt: Date;
  paidAt: Date | null;
  validUntilAfter: Date | null;
}): OrderView {
  return {
    id: row.id,
    transactionId: row.transactionId,
    status: row.status,
    planText: planText(row.productLimit, parseModules(row.modules)),
    months: row.months,
    subtotal: row.subtotal.toFixed(2),
    discount: row.discount.toFixed(2),
    tax: row.tax.toFixed(2),
    total: row.total.toFixed(2),
    provider: row.provider,
    createdAt: row.createdAt,
    paidAt: row.paidAt,
    validUntil: row.validUntilAfter,
  };
}

/**
 * One order of the company, for its status page. While it waits for the
 * provider, asks it first: coming back from paying shows the real state.
 */
export async function getOrder(
  actor: Actor,
  orderId: string,
): Promise<OrderView | null> {
  await assertOwnerAction(actor.organizationId, actor.userId, PERMISSION);
  const id = String(orderId);
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try {
    await confirmOrder(actor.organizationId, id);
  } catch (error) {
    // The provider did not answer: show what we know and ask again later.
    log.warn("checkout_status_unavailable", {
      orderId: id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const row = await forOrganization(
    actor.organizationId,
  ).checkoutOrder.findFirst({ where: { id }, select: ORDER_SELECT });
  return row ? toView(row) : null;
}

/** Purchases of the company, newest first. */
export async function listOrders(actor: Actor): Promise<OrderView[]> {
  await assertOwnerAction(actor.organizationId, actor.userId, PERMISSION);
  const rows = await forOrganization(
    actor.organizationId,
  ).checkoutOrder.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: ORDER_SELECT,
  });
  return rows.map(toView);
}

// ── Receipt email ───────────────────────────────────────────────────────

const PAID_WITH: Record<OrderView["provider"], string> = {
  STRIPE: "Tarjeta u OXXO (Stripe)",
  PAYPAL: "PayPal",
  MERCADOPAGO: "Mercado Pago",
  CODE: "Código de descuento",
};

async function sendReceipt(organizationId: string, orderId: string) {
  const order = await forOrganization(organizationId).checkoutOrder.findFirst({
    where: { id: orderId, status: "PAID" },
    select: { ...ORDER_SELECT, userId: true },
  });
  if (!order) return { skipped: true };
  const [user, company] = await Promise.all([
    db.user.findUnique({
      where: { id: order.userId },
      select: { email: true, name: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
  ]);
  if (!user || !company) return { skipped: true };
  const view = toView(order);
  const day = (date: Date) =>
    new Intl.DateTimeFormat("es-MX", {
      dateStyle: "long",
      timeZone: "America/Mexico_City",
    }).format(date);
  await sendEmail(
    planPurchaseEmail({
      to: user.email,
      name: user.name,
      organizationName: company.name,
      transactionId: view.transactionId,
      planText: view.planText,
      months: view.months,
      subtotal: formatMxn(view.subtotal),
      discount: dec(view.discount).isZero() ? null : formatMxn(view.discount),
      tax: formatMxn(view.tax),
      total: formatMxn(view.total),
      paidWith: PAID_WITH[view.provider],
      validUntil: view.validUntil ? day(view.validUntil) : "",
      refundTerms: REFUND_TERMS,
      planUrl: `${baseUrl()}/configuracion/plan`,
    }),
  );
  return { sent: true };
}

/** Registered by the worker (src/modules/registry/jobs.ts). */
export const billingJobHandlers: JobHandlers = {
  [RECEIPT_JOB_TYPE]: {
    // shortcut: a retry after the email left can send it twice; a sent-at mark if that ever matters.
    handle: (context) =>
      sendReceipt(
        context.organizationId,
        String((context.payload as { orderId?: unknown }).orderId ?? ""),
      ),
  },
};
