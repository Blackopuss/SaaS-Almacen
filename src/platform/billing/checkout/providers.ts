import "server-only";

import { mercadopagoProvider } from "./mercadopago";
import { paypalProvider } from "./paypal";
import type { PaymentProvider, ProviderId } from "./provider";
import { stripeProvider } from "./stripe";

/** Every adapter, in the order the buttons are offered (ADR 0028). */
export const PAYMENT_PROVIDERS: readonly PaymentProvider[] = [
  stripeProvider,
  mercadopagoProvider,
  paypalProvider,
];

export function findProvider(id: string): PaymentProvider | null {
  return PAYMENT_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Providers with keys configured: the only ones offered and accepted. */
export function enabledProviders(): PaymentProvider[] {
  return PAYMENT_PROVIDERS.filter((provider) => provider.enabled());
}

export type { ProviderId };
