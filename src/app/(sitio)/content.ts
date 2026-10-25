/**
 * Content of the public site (landing, prices, about, legal). One place for
 * the data the founder still has to confirm: contact address, legal name and
 * launch prices (FUN-06, PIL-08). The capacity tiers come from the plan
 * (PROPOSED_TIERS); the prices below are a proposal, not an approved list.
 */

import { CONTACT_EMAIL, PLAN_TIERS } from "@/platform/billing";

export const SITE = {
  name: "Almacén",
  /** Pending (founder): the real contact mailbox (also in the receipts). */
  contactEmail: CONTACT_EMAIL,
  /** Pending (founder): legal name of the company that runs the service. */
  legalName: "Almacén (razón social por confirmar)",
} as const;

export const SITE_NAV = [
  { href: "/funciones", label: "Funciones" },
  { href: "/precios", label: "Precios" },
  { href: "/nosotros", label: "Nosotros" },
] as const;

export const FOOTER_LINKS = [
  {
    title: "Producto",
    links: [
      { href: "/funciones", label: "Funciones" },
      { href: "/precios", label: "Precios" },
      { href: "/registro", label: "Crear cuenta" },
      { href: "/ingresar", label: "Entrar" },
    ],
  },
  {
    title: "Empresa",
    links: [
      { href: "/nosotros", label: "Nosotros" },
      { href: "/nosotros#contacto", label: "Contacto" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacidad", label: "Aviso de privacidad" },
      { href: "/terminos", label: "Términos y condiciones" },
    ],
  },
] as const;

/**
 * Monthly prices in MXN before VAT, per capacity tier (same order as
 * PROPOSED_TIERS). Proposal for the launch: the founder confirms them in
 * FUN-06 before anyone is charged.
 */
export const TIER_PRICES = PLAN_TIERS.map(({ prices }) => ({
  // Whole pesos, for display only; the checkout charges the exact list.
  inventory: Number(prices.inventory),
  purchasing: Number(prices.purchasing),
}));

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("es-MX").format(value);
}
