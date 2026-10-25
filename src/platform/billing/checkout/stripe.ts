import "server-only";

import type { PaymentProvider } from "./provider";

/** Stripe adapter (ADR 0028). Placeholder until its integration lands. */
export const stripeProvider: PaymentProvider = {
  id: "stripe",
  label: "Tarjeta, Google Pay, Apple Pay u OXXO",
  checkoutHosts: [],
  enabled: () => false,
  createCheckout: () => Promise.reject(new Error("Stripe no está configurado")),
  verifyWebhook: () => Promise.resolve(null),
  fetchStatus: () => Promise.resolve({ state: "pending" }),
};
