import "server-only";

import type { PaymentProvider } from "./provider";

/** MercadoPago adapter (ADR 0028). Placeholder until its integration lands. */
export const mercadopagoProvider: PaymentProvider = {
  id: "mercadopago",
  label: "Mercado Pago",
  checkoutHosts: [],
  enabled: () => false,
  createCheckout: () =>
    Promise.reject(new Error("MercadoPago no está configurado")),
  verifyWebhook: () => Promise.resolve(null),
  fetchStatus: () => Promise.resolve({ state: "pending" }),
};
