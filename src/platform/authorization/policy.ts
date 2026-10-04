/**
 * Central authorization decision (USR-02). Pure: no database, no session.
 * Deny by default: a permission is granted only if the titular list or one
 * of the person's roles names it. Unknown roles and unknown permissions
 * grant nothing.
 */
import {
  OWNER_PERMISSIONS,
  ROLE_PERMISSIONS,
  isPermission,
  isRole,
  type Permission,
  type Role,
} from "./catalog";

/** Who is asking, inside one company. */
export type Subject = {
  /** The person is the company's titular (Organization.ownerUserId). */
  isOwner: boolean;
  /** Roles of their active membership. Values outside the catalog are ignored. */
  roles: readonly string[];
};

/** Known roles of the subject, without repeats, in catalog order. */
export function knownRoles(roles: readonly string[]): Role[] {
  return [...new Set(roles.filter(isRole))].sort();
}

/** Every permission of the subject: roles combine by union (USR-06). */
export function permissionsOf(subject: Subject): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  if (subject.isOwner === true) {
    for (const permission of OWNER_PERMISSIONS) granted.add(permission);
  }
  for (const role of knownRoles(subject.roles)) {
    for (const permission of ROLE_PERMISSIONS[role]) granted.add(permission);
  }
  return granted;
}

/** True only when the subject holds the permission. */
export function can(subject: Subject, permission: Permission): boolean {
  if (!isPermission(permission)) return false;
  return permissionsOf(subject).has(permission);
}

/** True when the subject holds every permission of the list (and it is not empty). */
export function canAll(
  subject: Subject,
  permissions: readonly Permission[],
): boolean {
  if (permissions.length === 0) return false;
  const granted = permissionsOf(subject);
  return permissions.every((p) => isPermission(p) && granted.has(p));
}

/** True when the subject holds at least one permission of the list. */
export function canAny(
  subject: Subject,
  permissions: readonly Permission[],
): boolean {
  const granted = permissionsOf(subject);
  return permissions.some((p) => isPermission(p) && granted.has(p));
}
