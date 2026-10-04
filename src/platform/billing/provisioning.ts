import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { requireSession } from "@/platform/auth";
import {
  getEntitlements,
  getQuotaUsage,
  invalidateEntitlements,
} from "@/platform/entitlements";
import { db } from "@/server";

import type { ModuleRegistry } from "./registry";

/**
 * Manual provisioning by platform staff (MOD-09). While payments are
 * handled by hand (pilots pay by bank transfer), a person of our team
 * assigns what a company may use: product quota, seats, modules and until
 * when. Everything is written in one transaction, with the staff member
 * and the reason in the company's audit log.
 *
 * Platform staff are rows of `platform_staff`, added only from the command
 * line. Being the titular of a company never makes someone staff.
 */

/** Whether the account is active platform staff. */
export async function isPlatformStaff(userId: string): Promise<boolean> {
  const count = await db.platformStaff.count({
    where: { userId, disabledAt: null },
  });
  return count > 0;
}

/**
 * Guard for the internal console and its actions: session, MFA already on
 * and platform staff. Anyone else gets "not found": the console does not
 * announce itself.
 */
export async function requirePlatformStaff(): Promise<{
  userId: string;
  name: string;
}> {
  const session = await requireSession();
  if (!session.mfaEnabled || !(await isPlatformStaff(session.user.id))) {
    notFound();
  }
  return { userId: session.user.id, name: session.user.name };
}

/** Capacity tiers proposed in the plan (prices are not validated yet, FUN-06). */
export const PROPOSED_TIERS = [
  { productLimit: 100, users: 2 },
  { productLimit: 500, users: 3 },
  { productLimit: 1000, users: 5 },
  { productLimit: 3000, users: 8 },
  { productLimit: 10000, users: 15 },
] as const;

const provisionSchema = z.object({
  productLimit: z.coerce
    .number("Escribe el cupo de productos.")
    .int("El cupo de productos debe ser un número entero.")
    .min(1, "El cupo de productos debe ser al menos 1.")
    .max(1_000_000, "El cupo de productos es demasiado grande."),
  users: z.coerce
    .number("Escribe los usuarios incluidos.")
    .int("Los usuarios deben ser un número entero.")
    .min(1, "Debe haber al menos 1 usuario.")
    .max(10_000, "El número de usuarios es demasiado grande."),
  modules: z.array(z.string()).max(50),
  validUntil: z
    .date()
    .nullable()
    .refine((date) => date === null || date.getTime() > Date.now(), {
      message: "La vigencia debe terminar en el futuro.",
    }),
  reason: z
    .string()
    .trim()
    .min(5, "Escribe el motivo (por ejemplo, el pago que lo respalda).")
    .max(500, "El motivo es demasiado largo."),
});

export type ProvisionInput = {
  productLimit: number | string;
  users: number | string;
  modules: string[];
  /** Null = without end date. */
  validUntil: Date | null;
  reason: string;
};
export type ProvisionField = keyof ProvisionInput;

export type ProvisionResult =
  | { ok: true }
  | {
      ok: false;
      fieldErrors: Partial<Record<ProvisionField, string>>;
      formError?: string;
    };

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function setEntitlement(
  tx: Tx,
  organizationId: string,
  kind: "MODULE" | "LIMIT",
  key: string,
  value: number | null,
  validUntil: Date | null,
  now: Date,
) {
  const where = {
    organizationId_kind_key: { organizationId, kind, key },
  };
  const current = await tx.entitlement.findUnique({
    where,
    select: { validFrom: true, validUntil: true },
  });
  const live =
    current !== null &&
    current.validFrom <= now &&
    (current.validUntil === null || current.validUntil > now);
  await tx.entitlement.upsert({
    where,
    // A right that is already in force keeps its original start.
    update: { value, validUntil, ...(live ? {} : { validFrom: now }) },
    create: {
      id: newId(),
      organizationId,
      kind,
      key,
      value,
      validFrom: now,
      validUntil,
    },
  });
}

/**
 * Assigns the plan of a company: limits, modules and validity. The set of
 * modules must contain the base and the dependencies of each one; modules
 * left out are closed (their data stays).
 */
export async function provisionCompany(
  registry: ModuleRegistry,
  staffUserId: string,
  organizationId: string,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  if (!(await isPlatformStaff(staffUserId))) {
    return {
      ok: false,
      fieldErrors: {},
      formError: "No tienes permiso para hacer esto.",
    };
  }
  const parsed = provisionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ProvisionField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as ProvisionField;
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const { productLimit, users, validUntil, reason } = parsed.data;
  const modules = [...new Set(parsed.data.modules)];

  const moduleError = (message: string): ProvisionResult => ({
    ok: false,
    fieldErrors: { modules: message },
  });
  for (const id of modules) {
    if (!registry.has(id)) return moduleError("Uno de los módulos no existe.");
    const contract = registry.get(id);
    if (contract.availability !== "available") {
      return moduleError(`${contract.name} todavía no está disponible.`);
    }
    const missing = registry
      .dependenciesOf(id)
      .filter((dependency) => !modules.includes(dependency.id));
    if (missing.length > 0) {
      return moduleError(
        `${contract.name} necesita ${missing.map((m) => m.name).join(" y ")}.`,
      );
    }
  }
  if (!modules.includes(registry.base.id)) {
    return moduleError(
      `${registry.base.name} es la base y siempre va incluido.`,
    );
  }

  const done = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
    if (rows.length === 0) return false;
    const now = new Date();
    await setEntitlement(
      tx,
      organizationId,
      "LIMIT",
      "active_products",
      productLimit,
      validUntil,
      now,
    );
    await setEntitlement(
      tx,
      organizationId,
      "LIMIT",
      "users",
      users,
      validUntil,
      now,
    );
    for (const id of modules) {
      await setEntitlement(
        tx,
        organizationId,
        "MODULE",
        id,
        null,
        validUntil,
        now,
      );
    }
    // Modules left out stop now; nothing is deleted.
    await tx.entitlement.updateMany({
      where: {
        organizationId,
        kind: "MODULE",
        key: { notIn: modules },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      data: { validUntil: now },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: staffUserId,
      action: "plan.provisioned",
      target: { type: "organization", id: organizationId },
      reason,
      metadata: {
        productLimit,
        users,
        modules: registry.all
          .filter((m) => modules.includes(m.id))
          .map((m) => m.name),
        validUntil: validUntil ? validUntil.toISOString() : null,
        byPlatformStaff: true,
      },
    });
    return true;
  });
  if (!done) {
    return { ok: false, fieldErrors: {}, formError: "Esa empresa no existe." };
  }
  invalidateEntitlements(organizationId);
  return { ok: true };
}

export type CompanySummary = {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  createdAt: Date;
};

/** Companies for the console, newest first, filtered by name or titular email. */
export async function listCompaniesForStaff(
  search = "",
  limit = 50,
): Promise<CompanySummary[]> {
  const text = search.trim().slice(0, 120);
  const rows = await db.organization.findMany({
    where: text
      ? {
          OR: [
            { name: { contains: text } },
            { owner: { email: { contains: text.toLowerCase() } } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      name: true,
      createdAt: true,
      owner: { select: { name: true, email: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerName: row.owner.name,
    ownerEmail: row.owner.email,
    createdAt: row.createdAt,
  }));
}

export type CompanyPlan = CompanySummary & {
  modules: string[];
  productLimit: number | null;
  productsUsed: number;
  users: number | null;
  activeMembers: number;
  /** Earliest end date among what is in force; null = no end date. */
  validUntil: Date | null;
};

/** Current plan of one company, for the console. Null if it does not exist. */
export async function getCompanyPlan(
  organizationId: string,
): Promise<CompanyPlan | null> {
  const row = await db.organization.findUnique({
    where: { id: String(organizationId) },
    select: {
      id: true,
      name: true,
      createdAt: true,
      owner: { select: { name: true, email: true } },
    },
  });
  if (!row) return null;
  invalidateEntitlements(row.id);
  const now = new Date();
  const [entitlements, products, activeMembers, ends] = await Promise.all([
    getEntitlements(row.id),
    getQuotaUsage(row.id, "active_products"),
    db.membership.count({
      where: { organizationId: row.id, status: "ACTIVE" },
    }),
    db.entitlement.findFirst({
      where: {
        organizationId: row.id,
        validFrom: { lte: now },
        validUntil: { gt: now },
      },
      orderBy: { validUntil: "asc" },
      select: { validUntil: true },
    }),
  ]);
  return {
    id: row.id,
    name: row.name,
    ownerName: row.owner.name,
    ownerEmail: row.owner.email,
    createdAt: row.createdAt,
    modules: [...entitlements.modules],
    productLimit: entitlements.limit("active_products"),
    productsUsed: products.used + products.reserved,
    users: entitlements.limit("users"),
    activeMembers,
    validUntil: ends?.validUntil ?? null,
  };
}
