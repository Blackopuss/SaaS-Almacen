-- Roles of the launch catalog (USR-01, docs/MATRIZ_ROLES_PERMISOS.md).
-- The titular is not a role (Organization.ownerUserId). Adding a role needs
-- a migration and the catalog in src/platform/authorization/catalog.ts.
ALTER TABLE `membership_role`
  ADD CONSTRAINT `membership_role_role_check`
  CHECK (`role` IN ('administrator', 'warehouse', 'buyer', 'viewer'));
