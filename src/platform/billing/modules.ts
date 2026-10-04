import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { db } from "@/server";

import { invalidateEntitlements } from "@/platform/entitlements";
import type { ModuleRegistry } from "./registry";

/**
 * Turning modules on and off for a company (MOD-06), respecting the
 * dependencies declared in the contracts: a module needs its dependencies
 * active, and cannot be removed while something active needs it.
 *
 * These functions write entitlements. They are called by the server on
 * behalf of platform staff (MOD-09) or the payment flow (BIL), never with
 * values chosen by the customer. The company row is locked so two changes
 * cannot both pass the dependency check.
 */

export type ModuleChangeReason =
  | "unknown_module"
  | "unavailable"
  | "missing_dependencies"
  | "has_dependents"
  | "required"
  | "unknown_company"
  | "unchanged";

export type ModuleChangeResult =
  | { ok: true }
  | {
      ok: false;
      reason: ModuleChangeReason;
      error: string;
      /** Names of the modules that block the change. */
      modules: string[];
    };

const fail = (
  reason: ModuleChangeReason,
  error: string,
  modules: string[] = [],
): ModuleChangeResult => ({ ok: false, reason, error, modules });

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Locks the company and returns the ids of its modules active right now. */
async function lockAndReadActive(
  tx: Tx,
  organizationId: string,
): Promise<Set<string> | null> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) return null;
  const now = new Date();
  const entitlements = await tx.entitlement.findMany({
    where: {
      organizationId,
      kind: "MODULE",
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    select: { key: true },
  });
  return new Set(entitlements.map((e) => e.key));
}

export type ModuleChangeInput = {
  organizationId: string;
  moduleId: string;
  /** Staff member or system (null) making the change; recorded in the audit log. */
  actorUserId: string | null;
  reason?: string;
};

/** Activates a module for a company. Its dependencies must already be active. */
export async function activateModule(
  registry: ModuleRegistry,
  input: ModuleChangeInput & { validUntil?: Date | null },
): Promise<ModuleChangeResult> {
  const { organizationId, moduleId } = input;
  if (!registry.has(moduleId)) {
    return fail("unknown_module", "Ese módulo no existe.");
  }
  const contract = registry.get(moduleId);
  if (contract.availability !== "available") {
    return fail("unavailable", `${contract.name} todavía no está disponible.`, [
      contract.name,
    ]);
  }

  const result = await db.$transaction(async (tx) => {
    const active = await lockAndReadActive(tx, organizationId);
    if (!active) return fail("unknown_company", "Esa empresa no existe.");
    const missing = registry
      .dependenciesOf(moduleId)
      .filter((dependency) => !active.has(dependency.id))
      .map((dependency) => dependency.name);
    if (missing.length > 0) {
      return fail(
        "missing_dependencies",
        `${contract.name} necesita ${list(missing)}. Actívalo primero.`,
        missing,
      );
    }
    const validUntil = input.validUntil ?? null;
    if (active.has(moduleId) && validUntil === null) {
      const current = await tx.entitlement.findUnique({
        where: {
          organizationId_kind_key: {
            organizationId,
            kind: "MODULE",
            key: moduleId,
          },
        },
        select: { validUntil: true },
      });
      if (current?.validUntil === null) {
        return fail("unchanged", `${contract.name} ya está activo.`);
      }
    }
    const now = new Date();
    await tx.entitlement.upsert({
      where: {
        organizationId_kind_key: {
          organizationId,
          kind: "MODULE",
          key: moduleId,
        },
      },
      // Keeps the original start while it stays active without a gap.
      update: active.has(moduleId)
        ? { validUntil }
        : { validFrom: now, validUntil },
      create: {
        id: newId(),
        organizationId,
        kind: "MODULE",
        key: moduleId,
        validFrom: now,
        validUntil,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: input.actorUserId,
      action: "module.activated",
      target: { type: "module", id: moduleId },
      reason: input.reason,
      metadata: {
        module: contract.name,
        validUntil: validUntil ? validUntil.toISOString() : null,
      },
    });
    return { ok: true } as const;
  });
  if (result.ok) invalidateEntitlements(organizationId);
  return result;
}

/**
 * Deactivates a module: new operations stop at once; its data and history
 * stay. Refused while another active module depends on it, and for the base.
 */
export async function deactivateModule(
  registry: ModuleRegistry,
  input: ModuleChangeInput,
): Promise<ModuleChangeResult> {
  const { organizationId, moduleId } = input;
  if (!registry.has(moduleId)) {
    return fail("unknown_module", "Ese módulo no existe.");
  }
  const contract = registry.get(moduleId);

  const result = await db.$transaction(async (tx) => {
    const active = await lockAndReadActive(tx, organizationId);
    if (!active) return fail("unknown_company", "Esa empresa no existe.");
    if (!active.has(moduleId)) {
      return fail("unchanged", `${contract.name} no está activo.`);
    }
    const dependents = registry
      .dependentsOf(moduleId)
      .filter((dependent) => active.has(dependent.id))
      .map((dependent) => dependent.name);
    if (dependents.length > 0) {
      return fail(
        "has_dependents",
        `No se puede quitar ${contract.name} mientras ${list(dependents)} ${dependents.length === 1 ? "esté activo" : "estén activos"}.`,
        dependents,
      );
    }
    if (contract.required) {
      return fail(
        "required",
        `${contract.name} es la base de la empresa y no se puede quitar.`,
        [contract.name],
      );
    }
    await tx.entitlement.update({
      where: {
        organizationId_kind_key: {
          organizationId,
          kind: "MODULE",
          key: moduleId,
        },
      },
      data: { validUntil: new Date() },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: input.actorUserId,
      action: "module.deactivated",
      target: { type: "module", id: moduleId },
      reason: input.reason,
      metadata: { module: contract.name },
    });
    return { ok: true } as const;
  });
  if (result.ok) invalidateEntitlements(organizationId);
  return result;
}
