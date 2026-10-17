-- La lista de proveedores ordena por nombre y busca por nombre y RFC:
-- las dos columnas van en el índice que la recorre (CMP-02).
CREATE INDEX `contact_organizationId_isSupplier_name_rfc_id_idx` ON `contact`(`organizationId`, `isSupplier`, `name`, `rfc`, `id`);

-- DropIndex
DROP INDEX `contact_organizationId_isSupplier_name_id_idx` ON `contact`;
