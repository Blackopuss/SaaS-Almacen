import "server-only";

import { z } from "zod";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { normalizeSearch } from "@/platform/catalog";
import { forOrganization } from "@/server";

/**
 * Suppliers (CMP-02): the contacts of the company in their supplier facet
 * (ADR 0016). Compras creates, edits and looks them up here; a contact
 * that is only a customer is not reached by any of these functions.
 *
 * The RFC is optional and, when given, must have the shape of a real one.
 * Two contacts may share an RFC or a name — branches, the generic RFC of
 * the general public — so a likely duplicate is a warning the person
 * answers, never a refusal: the first attempt comes back with what looks
 * the same, and saving again with `acceptDuplicates` goes through.
 */

/** Who is acting; always taken from the session, never from the form. */
export type ContactActor = { organizationId: string; userId: string };

const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .regex(NO_CONTROL, "Quita los saltos de línea o tabuladores.")
    .max(max, `Máximo ${max} caracteres.`);

const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => (value ? value : null));

/**
 * An RFC as it is stored: capitals, no spaces, dashes or dots. Null when
 * the text is not one — 12 characters for a company, 13 for a person,
 * with a real date in the middle.
 */
export function normalizeRfc(value: string): string | null {
  const rfc = value.toUpperCase().replace(/[\s.\-_/]/g, "");
  const match = /^[A-ZÑ&]{3,4}(\d{2})(\d{2})(\d{2})[A-Z0-9]{3}$/.exec(rfc);
  if (!match) return null;
  const [month, day] = [Number(match[2]), Number(match[3])];
  // The year has two digits: 29 February is allowed, the rest is checked.
  const daysIn = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysIn[month - 1]!) {
    return null;
  }
  return rfc;
}

const RFC_PROBLEM =
  "Ese RFC no tiene la forma correcta: 12 caracteres para una empresa (ABC010203XY1) o 13 para una persona (ABCD010203XY1). Déjalo vacío si no lo tienes.";

export const supplierSchema = z.object({
  name: text(160).min(2, "Escribe el nombre del proveedor (mínimo 2 letras)."),
  legalName: optionalText(200),
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
  contactPerson: optionalText(120),
  email: z
    .string()
    .trim()
    .max(254, "El correo es demasiado largo.")
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null))
    .refine(
      (value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      "Escribe un correo como ventas@proveedor.com, o déjalo vacío.",
    ),
  phone: optionalText(40),
  address: optionalText(300),
  notes: z
    .string()
    .trim()
    .max(500, "Las notas admiten hasta 500 caracteres.")
    .optional()
    .transform((value) => (value ? value : null)),
});

export type SupplierInput = z.input<typeof supplierSchema>;
export type SupplierField = keyof SupplierInput;

/** A contact of the company that looks like the one being saved. */
export type SupplierDuplicate = {
  id: string;
  name: string;
  rfc: string | null;
  /** It is already a supplier (it may be only a customer). */
  isSupplier: boolean;
  archived: boolean;
  /** What it shares with the one being saved. */
  match: "rfc" | "name";
};

export type SaveSupplierResult =
  | { ok: true; supplierId: string }
  | {
      ok: false;
      reason: "invalid" | "not_found";
      fieldErrors: Partial<Record<SupplierField, string>>;
      formError?: string;
    }
  | {
      ok: false;
      /** Nothing was saved: the person decides whether it is another one. */
      reason: "duplicate";
      duplicates: SupplierDuplicate[];
      fieldErrors: Partial<Record<SupplierField, string>>;
    };

type Parsed = z.output<typeof supplierSchema>;

function parse(
  input: SupplierInput,
): { ok: true; data: Parsed } | Extract<SaveSupplierResult, { ok: false }> {
  const parsed = supplierSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Partial<Record<SupplierField, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as SupplierField;
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, reason: "invalid", fieldErrors };
}

type Client = ReturnType<typeof forOrganization>;

/**
 * Contacts of the company with the same RFC or the same name (whatever
 * its capitals or accents: the database compares them that way).
 */
async function findDuplicates(
  client: Pick<Client, "contact">,
  data: { name: string; rfc: string | null },
  exceptId: string | null,
): Promise<SupplierDuplicate[]> {
  const rows = await client.contact.findMany({
    where: {
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [{ name: data.name }, ...(data.rfc ? [{ rfc: data.rfc }] : [])],
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 5,
    select: {
      id: true,
      name: true,
      rfc: true,
      isSupplier: true,
      archivedAt: true,
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    rfc: row.rfc,
    isSupplier: row.isSupplier,
    archived: row.archivedAt !== null,
    match: data.rfc && row.rfc === data.rfc ? "rfc" : "name",
  }));
}

/**
 * Creates a supplier. A contact that looks the same stops the first
 * attempt with a warning; `acceptDuplicates` saves it anyway.
 */
export async function createSupplier(
  actor: ContactActor,
  input: SupplierInput,
  options: { acceptDuplicates?: boolean } = {},
): Promise<SaveSupplierResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.supplier.create",
  );
  const parsed = parse(input);
  if (!parsed.ok) return parsed;
  const { data } = parsed;
  const client = forOrganization(organizationId);
  if (options.acceptDuplicates !== true) {
    const duplicates = await findDuplicates(client, data, null);
    if (duplicates.length > 0) {
      return { ok: false, reason: "duplicate", duplicates, fieldErrors: {} };
    }
  }
  const supplierId = newId();
  await client.$transaction(async (tx) => {
    await tx.contact.create({
      data: {
        id: supplierId,
        organizationId,
        ...data,
        isSupplier: true,
        createdByUserId: userId,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "supplier.created",
      target: { type: "contact", id: supplierId },
      metadata: { nombre: data.name, rfc: data.rfc ?? "" },
    });
  });
  return { ok: true, supplierId };
}

/** Names of the fields, to say in the audit trail which ones changed. */
const FIELD_LABELS: Record<SupplierField, string> = {
  name: "Nombre",
  legalName: "Razón social",
  rfc: "RFC",
  contactPerson: "Persona de contacto",
  email: "Correo",
  phone: "Teléfono",
  address: "Dirección",
  notes: "Notas",
};

/**
 * Changes the card of a supplier of the company. Only what the form of a
 * supplier holds: its facets and whether it is archived are not touched.
 */
export async function updateSupplier(
  actor: ContactActor,
  supplierId: string,
  input: SupplierInput,
  options: { acceptDuplicates?: boolean } = {},
): Promise<SaveSupplierResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.supplier.update",
  );
  const parsed = parse(input);
  if (!parsed.ok) return parsed;
  const { data } = parsed;
  const client = forOrganization(organizationId);
  const id = String(supplierId).slice(0, 36);
  const notFound: SaveSupplierResult = {
    ok: false,
    reason: "not_found",
    fieldErrors: {},
    formError: "Este proveedor ya no existe.",
  };
  const current = await client.contact.findFirst({
    where: { id, isSupplier: true },
  });
  if (!current) return notFound;
  const changed = (Object.keys(FIELD_LABELS) as SupplierField[]).filter(
    (field) => (current[field] ?? null) !== data[field],
  );
  if (changed.length === 0) return { ok: true, supplierId: current.id };

  // Only a change of name or RFC can make it look like another contact.
  if (
    options.acceptDuplicates !== true &&
    (changed.includes("name") || changed.includes("rfc"))
  ) {
    const duplicates = await findDuplicates(client, data, current.id);
    if (duplicates.length > 0) {
      return { ok: false, reason: "duplicate", duplicates, fieldErrors: {} };
    }
  }
  const saved = await client.$transaction(async (tx) => {
    const updated = await tx.contact.updateMany({
      where: { id: current.id, isSupplier: true },
      data,
    });
    if (updated.count !== 1) return false;
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "supplier.updated",
      target: { type: "contact", id: current.id },
      metadata: {
        nombre: data.name,
        cambios: changed.map((field) => FIELD_LABELS[field]).join(", "),
      },
    });
    return true;
  });
  return saved ? { ok: true, supplierId: current.id } : notFound;
}

export type SupplierDetail = {
  id: string;
  name: string;
  legalName: string | null;
  rfc: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  /** It is also a customer (Ventas, CRM). */
  isCustomer: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** A supplier of the company; null when it is not one of its suppliers. */
export async function getSupplier(
  actor: ContactActor,
  supplierId: string,
): Promise<SupplierDetail | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.supplier.read",
  );
  const row = await forOrganization(actor.organizationId).contact.findFirst({
    where: { id: String(supplierId).slice(0, 36), isSupplier: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    rfc: row.rfc,
    contactPerson: row.contactPerson,
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    isCustomer: row.isCustomer,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type SupplierSummary = {
  id: string;
  name: string;
  rfc: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
};

export const SUPPLIER_PAGE_SIZE = 25;
const SEARCH_MAX_TERMS = 6;

export type SupplierPage = {
  items: SupplierSummary[];
  /** Suppliers that match, in every page. */
  total: number;
  /** Page actually returned (1-based); a page past the end becomes the last. */
  page: number;
  pageSize: number;
  pageCount: number;
  /** The search as it was applied; "" without one. */
  search: string;
};

/** `%`, `_` and `\` are text to find, not wildcards. */
const literal = (term: string) => term.replace(/[\\%_]/g, "\\$&");

const clamp = (value: number | undefined, min: number, max: number) =>
  value === undefined || !Number.isSafeInteger(value)
    ? min
    : Math.min(Math.max(value, min), max);

/**
 * One page of the active suppliers of the company, by name, optionally
 * narrowed by a search over name and RFC. The database counts, filters
 * and cuts the page inside one index (company, facet, name, RFC, id).
 */
export async function listSuppliers(
  actor: ContactActor,
  options: { search?: unknown; page?: number; pageSize?: number } = {},
): Promise<SupplierPage> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.supplier.read",
  );
  const pageSize =
    options.pageSize === undefined
      ? SUPPLIER_PAGE_SIZE
      : clamp(options.pageSize, 1, 100);
  const search = normalizeSearch(options.search);
  const where = {
    isSupplier: true,
    archivedAt: null,
    AND: search
      .split(" ")
      .filter(Boolean)
      .slice(0, SEARCH_MAX_TERMS)
      .map((term) => {
        const contains = literal(term);
        return { OR: [{ name: { contains } }, { rfc: { contains } }] };
      }),
  };
  const client = forOrganization(actor.organizationId);
  const total = await client.contact.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = clamp(options.page, 1, pageCount);
  const rows = await client.contact.findMany({
    where,
    // The id breaks ties between equal names, so pages never repeat one.
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      name: true,
      rfc: true,
      contactPerson: true,
      phone: true,
      email: true,
    },
  });
  return { items: rows, total, page, pageSize, pageCount, search };
}
