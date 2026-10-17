/**
 * What a contact is for the business (CMP-01). A contact is one row
 * shared by every module; each facet says which module may work with it:
 * suppliers are for Compras, customers for Ventas and CRM. The same
 * business can be both — the hardware store that sells to you and buys
 * from you — without being captured twice.
 */
export const CONTACT_FACETS = ["supplier", "customer"] as const;
export type ContactFacet = (typeof CONTACT_FACETS)[number];

export const CONTACT_FACET_LABELS: Record<ContactFacet, string> = {
  supplier: "Proveedor",
  customer: "Cliente",
};

export const isContactFacet = (value: unknown): value is ContactFacet =>
  typeof value === "string" &&
  (CONTACT_FACETS as readonly string[]).includes(value);

/** Column of `contact` that holds each facet. */
export const CONTACT_FACET_COLUMN = {
  supplier: "isSupplier",
  customer: "isCustomer",
} as const satisfies Record<ContactFacet, string>;
