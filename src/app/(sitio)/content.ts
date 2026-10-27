/**
 * Content of the public site (landing, prices, about, legal). One place for
 * the data the founder still has to confirm: legal name and launch prices
 * (FUN-06, PIL-08). The capacity tiers come from the plan
 * (PROPOSED_TIERS); the prices below are a proposal, not an approved list.
 */

import { CONTACT_EMAIL, PLAN_TIERS } from "@/platform/billing";

export { SITE_NAV, formatCount, formatMoney } from "./site-shared";

export const SITE = {
  name: "Almacén",
  /** Contact mailbox (also in the receipts and legal texts). */
  contactEmail: CONTACT_EMAIL,
  /** Pending (founder): legal name of the company that runs the service. */
  legalName: "Almacén (razón social por confirmar)",
} as const;

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
 * Monthly prices in MXN, VAT included, per capacity tier (same order as
 * PROPOSED_TIERS). Proposal for the launch: the founder confirms them in
 * FUN-06 before anyone is charged.
 */
export const TIER_PRICES = PLAN_TIERS.map(({ prices }) => ({
  // Whole pesos, for display only; the checkout charges the exact list.
  inventory: Number(prices.inventory),
  purchasing: Number(prices.purchasing),
}));
