import "server-only";

import { z } from "zod";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { normalizeSearch } from "@/platform/catalog";
import { forOrganization } from "@/server";

import { normalizeRfc, type ContactActor } from "./suppliers";

/**
 * Customers (VEN-08): the contacts of the company in their customer facet
 * (ADR 0016). Ventas looks them up and registers new ones at the counter
 * with the least it needs — a name, and a phone or RFC if the customer
 * gives one. A contact that is only a supplier is not reached from here.
 */

const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

const RFC_PROBLEM =
  "Ese RFC no tiene la forma correcta: 12 caracteres para una empresa o 13 para una persona. Déjalo vacío si no lo tienes.";

export const customerSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(NO_CONTROL, "Quita los saltos de línea o tabuladores.")
    .min(2, "Escribe el nombre del cliente (mínimo 2 letras).")
    .max(160, "Máximo 160 caracteres."),
  phone: z
    .string()
    .trim()
    .regex(NO_CONTROL, "Quita los saltos de línea o tabuladores.")
    .max(40, "Máximo 40 caracteres.")
    .optional()
    .transform((value) => value || null),
  rfc: z
    .string()
    .trim()
    .max(20, RFC_PROBLEM)
    .optional()
    .transform((value, context) => {
      if (!value) return null;
      const rfc = normalizeRfc(value);
      if (!rfc) {
        context.addIssue({ code: "custom", message: RFC_PROBLEM });
        return z.NEVER;
      }
      return rfc;
    }),
});

export type CustomerInput = z.input<typeof customerSchema>;
export type CustomerField = keyof CustomerInput;

export type CustomerSummary = {
  id: string;
  name: string;
  rfc: string | null;
  phone: string | null;
};

export type CreateCustomerResult =
  | { ok: true; customer: CustomerSummary }
  | {
      ok: false;
      reason: "invalid";
      fieldErrors: Partial<Record<CustomerField, string>>;
    }
  | {
      ok: false;
      /** Nothing was saved: a customer with that name or RFC exists. */
      reason: "duplicate";
      duplicates: CustomerSummary[];
      fieldErrors: Partial<Record<CustomerField, string>>;
    };

const summary = {
  id: true,
  name: true,
  rfc: true,
  phone: true,
} as const;

const SEARCH_MAX_TERMS = 6;
/** `%`, `_` and `\` are text to find, not wildcards. */
const literal = (term: string) => term.replace(/[\\%_]/g, "\\$&");

/** Active customers whose name, RFC or phone has every word typed. */
export async function findCustomers(
  actor: ContactActor,
  search: unknown,
): Promise<CustomerSummary[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.customer.read",
  );
  const terms = normalizeSearch(search)
    .split(" ")
    .filter(Boolean)
    .slice(0, SEARCH_MAX_TERMS);
  if (terms.length === 0) return [];
  return forOrganization(actor.organizationId).contact.findMany({
    where: {
      isCustomer: true,
      archivedAt: null,
      AND: terms.map((term) => {
        const contains = literal(term);
        return {
          OR: [
            { name: { contains } },
            { rfc: { contains } },
            { phone: { contains } },
          ],
        };
      }),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 8,
    select: summary,
  });
}

/** A customer of the company; null when it is not one, or is archived. */
export async function getCustomer(
  actor: ContactActor,
  customerId: string,
): Promise<CustomerSummary | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.customer.read",
  );
  return forOrganization(actor.organizationId).contact.findFirst({
    where: {
      id: String(customerId).slice(0, 36),
      isCustomer: true,
      archivedAt: null,
    },
    select: summary,
  });
}

/**
 * Registers a customer. One with the same name or RFC stops the first
 * attempt (the cashier most likely wants that one); `acceptDuplicates`
 * saves it anyway — two customers may share a name.
 */
export async function createCustomer(
  actor: ContactActor,
  input: CustomerInput,
  options: { acceptDuplicates?: boolean } = {},
): Promise<CreateCustomerResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.customer.create");
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<CustomerField, string>> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path[0] as CustomerField] ??= issue.message;
    }
    return { ok: false, reason: "invalid", fieldErrors };
  }
  const data = parsed.data;
  const client = forOrganization(organizationId);
  if (options.acceptDuplicates !== true) {
    const duplicates = await client.contact.findMany({
      where: {
        isCustomer: true,
        archivedAt: null,
        OR: [{ name: data.name }, ...(data.rfc ? [{ rfc: data.rfc }] : [])],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 5,
      select: summary,
    });
    if (duplicates.length > 0) {
      return { ok: false, reason: "duplicate", duplicates, fieldErrors: {} };
    }
  }
  const id = newId();
  await client.$transaction(async (tx) => {
    await tx.contact.create({
      data: {
        id,
        organizationId,
        ...data,
        isCustomer: true,
        createdByUserId: userId,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "customer.created",
      target: { type: "contact", id },
      metadata: { nombre: data.name },
    });
  });
  return { ok: true, customer: { id, ...data } };
}
