import "server-only";

import { cache } from "react";

import { ForbiddenError } from "@/lib";
import {
  requireOrganizationContext,
  type OrganizationContext,
} from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

import type { Permission, Role } from "./catalog";
import { can, knownRoles, permissionsOf, type Subject } from "./policy";

/**
 * Authorization against the database (USR-02). The subject is read on every
 * request from the active membership and the company's titular; nothing
 * comes from the browser. No active membership → no permissions, even for
 * the titular.
 */

export const FORBIDDEN_MESSAGE = "No tienes permiso para hacer esto.";

const NOBODY: Subject = { isOwner: false, roles: [] };

/** Titular flag and roles of the person in that company. */
export async function loadSubject(
  organizationId: string,
  userId: string,
): Promise<Subject> {
  const membership = await forOrganization(organizationId).membership.findFirst(
    {
      where: { userId, status: "ACTIVE" },
      select: { roles: { select: { role: true } } },
    },
  );
  if (!membership) return NOBODY;
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { ownerUserId: true },
  });
  return {
    isOwner: organization?.ownerUserId === userId,
    roles: membership.roles.map((r) => r.role),
  };
}

/** Decision for one person, company and permission. */
export async function isAllowed(
  organizationId: string,
  userId: string,
  permission: Permission,
): Promise<boolean> {
  return can(await loadSubject(organizationId, userId), permission);
}

/** Throws ForbiddenError unless the person holds the permission. */
export async function assertAllowed(
  organizationId: string,
  userId: string,
  permission: Permission,
): Promise<void> {
  if (!(await isAllowed(organizationId, userId, permission))) {
    throw new ForbiddenError("permission_denied", FORBIDDEN_MESSAGE, {
      permission,
    });
  }
}

export type Access = OrganizationContext & {
  roles: Role[];
  permissions: ReadonlySet<Permission>;
  can: (permission: Permission) => boolean;
};

/** Session, active company and permissions of the request. Cached per request. */
export const getAccess = cache(async (): Promise<Access> => {
  const context = await requireOrganizationContext();
  const subject = await loadSubject(context.organization.id, context.user.id);
  const permissions = permissionsOf(subject);
  return {
    ...context,
    roles: knownRoles(subject.roles),
    permissions,
    can: (permission) => permissions.has(permission),
  };
});

/**
 * Guard for business screens and Server Actions: session + active company +
 * permission. Throws ForbiddenError when the permission is missing.
 */
export async function requirePermission(
  permission: Permission,
): Promise<Access> {
  const access = await getAccess();
  if (!access.can(permission)) {
    throw new ForbiddenError("permission_denied", FORBIDDEN_MESSAGE, {
      permission,
    });
  }
  return access;
}
