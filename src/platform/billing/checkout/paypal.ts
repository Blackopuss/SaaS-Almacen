import "server-only";

import type { PaymentProvider } from "./provider";

/** PayPal adapter (ADR 0028). Placeholder until its integration lands. */
export const paypalProvider: PaymentProvider = {
  id: "paypal",
  label: "PayPal",
  checkoutHosts: [],
  enabled: () => false,
  createCheckout: () => Promise.reject(new Error("PayPal no está configurado")),
  verifyWebhook: () => Promise.resolve(null),
  fetchStatus: () => Promise.resolve({ state: "pending" }),
};
