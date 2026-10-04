// Public API of platform/authorization: Predefined roles and permission checks (USR).
export {
  OWNER_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  isPermission,
  isRole,
} from "./catalog";
export type { Permission, Role } from "./catalog";
export {
  OWNER_ONLY_PERMISSIONS,
  can,
  canAll,
  canAny,
  isOwnerOnly,
  knownRoles,
  permissionsOf,
} from "./policy";
export type { Subject } from "./policy";
export {
  FORBIDDEN_MESSAGE,
  OWNER_ONLY_MESSAGE,
  assertAllowed,
  assertOwnerAction,
  getAccess,
  isAllowed,
  loadSubject,
  requireOwnerAction,
  requirePermission,
} from "./access";
export type { Access } from "./access";
