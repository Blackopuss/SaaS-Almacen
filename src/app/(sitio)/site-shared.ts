/**
 * Pieces of the public site that client components use. Kept apart from
 * content.ts, which imports @/platform/billing (server code).
 */

export const SITE_NAV = [
  { href: "/funciones", label: "Funciones" },
  { href: "/precios", label: "Precios" },
  { href: "/nosotros", label: "Nosotros" },
] as const;

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
