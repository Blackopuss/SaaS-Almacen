-- Corrige location_general_check (INV-14). Un CHECK solo rechaza cuando la
-- expresión es FALSA; con `isDefault` NULL la comparación `isDefault = 1`
-- daba «desconocido» y dejaba pasar una segunda ubicación de tipo GENERAL
-- sin marca de predeterminada. COALESCE vuelve la expresión verdadera o
-- falsa, nunca desconocida.
ALTER TABLE `location` DROP CHECK `location_general_check`;
ALTER TABLE `location` ADD CONSTRAINT `location_general_check` CHECK (
    (COALESCE(`isDefault`, 0) = 0 AND `kind` <> 'GENERAL')
    OR (COALESCE(`isDefault`, 0) = 1 AND `kind` = 'GENERAL' AND `parentId` IS NULL AND `archivedAt` IS NULL)
);
