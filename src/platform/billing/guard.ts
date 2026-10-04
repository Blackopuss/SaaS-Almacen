import "server-only";

import { cache } from "react";

import { ForbiddenError, LimitReachedError } from "@/lib";
import {
  FORBIDDEN_MESSAGE,
  getAccess,
  isAllowed,
  isPermission,
  type Access,
  type Permission,
} from "@/platform/authorization";

import { getEntitlements, type Entitlements } from "@/platform/entitlements";

/**
 * Server guard (MOD-05). An operation of a module is allowed only when all
 * of this holds, in order:
 *
 *   session → active membership → role grants the permission
 *           → the company has the module → (when it adds) the limit has room
 *
 * The first three come from platform/authorization; this file adds the
 * contracted module and the limit. Hiding a menu item is never the check:
 * calling the action directly ends here as well.
 */

export const MODULE_NOT_CONTRACTED_MESSAGE =
  "Tu empresa no tiene este módulo activo.";
export const LIMIT_REACHED_MESSAGE =
  "Llegaste al límite de tu plan. Para agregar más, cambia de nivel.";

/** Module that owns a permission ("inventory.product.read" → "inventory"); null for platform permissions. */
export function moduleOfPermission(permission: string): string | null {
  const prefix = permission.split(".")[0] ?? "";
  return prefix === "platform" || prefix === "" ? null : prefix;
}

/** Whether the entitlements cover the module of the permission. */
export function entitles(
  entitlements: Entitlements,
  permission: string,
): boolean {
  const moduleId = moduleOfPermission(permission);
  return moduleId === null || entitlements.hasModule(moduleId);
}

const denied = (permission: string) =>
  new ForbiddenError("permission_denied", FORBIDDEN_MESSAGE, { permission });

const notContracted = (permission: string) =>
  new ForbiddenError("module_not_contracted", MODULE_NOT_CONTRACTED_MESSAGE, {
    permission,
    module: moduleOfPermission(permission),
  });

/**
 * Guard for services: role and contracted module for one person, company
 * and permission. Throws ForbiddenError (`permission_denied` first, then
 * `module_not_contracted`).
 */
export async function assertModulePermission(
  organizationId: string,
  userId: string,
  permission: Permission,
): Promise<void> {
  if (!isPermission(permission)) throw denied(String(permission));
  if (!(await isAllowed(organizationId, userId, permission))) {
    throw denied(permission);
  }
  if (!entitles(await getEntitlements(organizationId), permission)) {
    throw notContracted(permission);
  }
}

export type ModuleAccess = Access & {
  entitlements: Entitlements;
  /** The company has the module. */
  hasModule(moduleId: string): boolean;
  /** The role grants the permission and the company has its module. */
  allows(permission: Permission): boolean;
};

/** Session, company, permissions and contracted modules of the request. Cached per request. */
export const getModuleAccess = cache(async (): Promise<ModuleAccess> => {
  const access = await getAccess();
  const entitlements = await getEntitlements(access.organization.id);
  return {
    ...access,
    entitlements,
    hasModule: (moduleId) => entitlements.hasModule(moduleId),
    allows: (permission) =>
      access.can(permission) && entitles(entitlements, permission),
  };
});

/** Guard for screens and Server Actions of a module. Throws like assertModulePermission. */
export async function requireModulePermission(
  permission: Permission,
): Promise<ModuleAccess> {
  const access = await getModuleAccess();
  if (!isPermission(permission) || !access.can(permission)) {
    throw denied(String(permission));
  }
  if (!entitles(access.entitlements, permission)) {
    throw notContracted(permission);
  }
  return access;
}

/**
 * Last step of the guard for operations that add something counted by the
 * plan. `used` is what the company has now and `adding` what the operation
 * would add. A limit that was never granted has no room (deny by default).
 * The counters with concurrency control arrive with MOD-07 and MOD-08.
 */
export function assertWithinLimit(
  entitlements: Entitlements,
  key: string,
  used: number,
  adding = 1,
): void {
  const limit = entitlements.limit(key);
  if (
    limit === null ||
    !Number.isInteger(used) ||
    !Number.isInteger(adding) ||
    adding < 0 ||
    used + adding > limit
  ) {
    throw new LimitReachedError("limit_reached", LIMIT_REACHED_MESSAGE, {
      key,
      limit,
      used,
      adding,
    });
  }
}
