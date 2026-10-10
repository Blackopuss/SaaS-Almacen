-- CreateTable
CREATE TABLE `contact` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `legalName` VARCHAR(200) NULL,
    `rfc` VARCHAR(13) NULL,
    `isSupplier` BOOLEAN NOT NULL DEFAULT false,
    `isCustomer` BOOLEAN NOT NULL DEFAULT false,
    `contactPerson` VARCHAR(120) NULL,
    `email` VARCHAR(254) NULL,
    `phone` VARCHAR(40) NULL,
    `address` VARCHAR(300) NULL,
    `notes` VARCHAR(500) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `contact_organizationId_isSupplier_name_id_idx`(`organizationId`, `isSupplier`, `name`, `id`),
    INDEX `contact_organizationId_isCustomer_name_id_idx`(`organizationId`, `isCustomer`, `name`, `id`),
    INDEX `contact_organizationId_rfc_idx`(`organizationId`, `rfc`),
    UNIQUE INDEX `contact_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `contact` ADD CONSTRAINT `contact_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Un contacto es proveedor, cliente o ambos: nunca ninguno.
ALTER TABLE `contact` ADD CONSTRAINT `contact_facet_check` CHECK (`isSupplier` = TRUE OR `isCustomer` = TRUE);

-- El nombre no queda en blanco.
ALTER TABLE `contact` ADD CONSTRAINT `contact_name_check` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0);

-- RFC, cuando existe: 12 (persona moral) o 13 (persona física) caracteres,
-- en mayúsculas y sin espacios. La expresión se evalúa distinguiendo
-- mayúsculas ('c'); un RFC vacío se guarda como NULL, no como ''.
ALTER TABLE `contact` ADD CONSTRAINT `contact_rfc_check` CHECK (
    `rfc` IS NULL OR REGEXP_LIKE(`rfc`, '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$', 'c')
);
