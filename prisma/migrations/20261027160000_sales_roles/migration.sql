-- VEN-02 (ADR 0030): roles de Ventas. Cajero (`cashier`) cobra, cotiza y
-- abre su caja; Encargado de caja (`cash_manager`) además autoriza
-- descuentos grandes, hace el corte, cancela y devuelve. Solo amplía la
-- lista: la versión anterior no asigna estos roles.
ALTER TABLE `membership_role` DROP CHECK `membership_role_role_check`;
ALTER TABLE `membership_role`
  ADD CONSTRAINT `membership_role_role_check`
  CHECK (`role` IN ('administrator', 'warehouse', 'buyer', 'viewer', 'cashier', 'cash_manager'));
