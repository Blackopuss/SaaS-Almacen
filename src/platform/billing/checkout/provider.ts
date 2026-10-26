/**
 * What every payment provider adapter implements (ADR 0028). The business
 * logic (orders, codes, plan validity) never depends on a provider: an
 * adapter only opens the provider's hosted checkout, proves that a webhook
 * came from it and reports the authoritative state of a payment. Adapters
 * talk to the provider's REST API with `fetch` (no SDK) and never see card
 * data: the customer pays on the provider's page.
 */

export type ProviderId = "stripe" | "paypal" | "mercadopago";

/** What the adapter needs to open a checkout. Amounts are exact strings. */
export type CheckoutRequest = {
  /** Our order id (UUIDv7): goes to the provider as its reference/metadata. */
  orderId: string;
  /** Shown to the customer and in the email, e.g. "AL-7F3K9Q2M". */
  transactionId: string;
  /** One line, e.g. "Almacén · 1,000 productos · Inventario + Compras · 3 meses". */
  description: string;
  /** Amount to charge, VAT included, two decimals: "1214.52". */
  total: string;
  currency: "MXN";
  /** Email of the owner, to prefill the provider's page. */
  customerEmail: string;
  /** Where the provider sends the customer back (our status page). */
  returnUrl: string;
  /** Where the provider sends the customer when they cancel. */
  cancelUrl: string;
  /** When our order stops being payable; the provider's session should too. */
  expiresAt: Date;
};

export type CheckoutSession = {
  /** The provider's id for this checkout (session / order / preference). */
  providerRef: string;
  /** Hosted page to send the customer to. Must be https on the provider's domain. */
  redirectUrl: string;
};

/**
 * Authoritative state of a checkout, read from the provider (never from
 * what the browser says). `amount`/`currency` are what was actually
 * captured; the core compares them with the order before granting anything.
 */
export type PaymentStatus =
  | {
      state: "paid";
      amount: string;
      currency: string;
      /** The provider's id of the captured payment (charge/capture/payment). */
      paymentRef: string;
    }
  | { state: "pending" }
  | { state: "failed" | "expired" };

/** A webhook whose signature was verified. */
export type VerifiedWebhook = {
  /** Unique id of the event at the provider: a repeated delivery has the same one. */
  eventId: string;
  type: string;
  /**
   * Checkout it is about (`providerRef`), when the event concerns one; the
   * core then asks `fetchStatus` for the authoritative state instead of
   * trusting the event body.
   */
  providerRef: string | null;
  /**
   * Our order id, when the event carries it instead of the checkout id
   * (e.g. Mercado Pago notifies a payment whose external_reference is it).
   * Only a hint to find the order: the state still comes from `fetchStatus`.
   */
  orderId: string | null;
};

/** A webhook as it arrived: the raw body untouched, the full URL (query included). */
export type WebhookRequest = { headers: Headers; rawBody: string; url: URL };

/** Identifies a checkout when asking for its state. */
export type CheckoutRef = { providerRef: string; orderId: string };

export interface PaymentProvider {
  readonly id: ProviderId;
  /** Short name in the list of ways to pay, e.g. "Tarjeta u OXXO". */
  readonly label: string;
  /** Whether its keys are configured; a provider without keys is not offered. */
  enabled(): boolean;
  /**
   * Hosts the browser is sent to (for the CSP `form-action` and the check
   * that `redirectUrl` belongs to the provider).
   */
  readonly checkoutHosts: readonly string[];
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /**
   * Verifies the signature of a webhook with the raw body exactly as it
   * arrived. Returns null when it does not come from the provider; throws
   * only on unexpected failures (network, provider down).
   */
  verifyWebhook(request: WebhookRequest): Promise<VerifiedWebhook | null>;
  fetchStatus(ref: CheckoutRef): Promise<PaymentStatus>;
}
