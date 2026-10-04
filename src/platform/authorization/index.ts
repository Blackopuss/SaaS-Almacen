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
export { can, canAll, canAny, knownRoles, permissionsOf } from "./policy";
export type { Subject } from "./policy";
export {
  FORBIDDEN_MESSAGE,
  assertAllowed,
  getAccess,
  isAllowed,
  loadSubject,
  requirePermission,
} from "./access";
export type { Access } from "./access";
