-- CreateTable
-- Una instalación por empresa en v1. Multi-sucursal requiere retirar
-- explícitamente facility_organizationId_key en su propia migración.
CREATE TABLE `facility` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `facility_organizationId_key`(`organizationId`),
    UNIQUE INDEX `facility_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `location` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `facilityId` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `isDefault` BOOLEAN NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `location_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `location_organizationId_facilityId_name_key`(`organizationId`, `facilityId`, `name`),
    UNIQUE INDEX `location_organizationId_facilityId_isDefault_key`(`organizationId`, `facilityId`, `isDefault`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `facility` ADD CONSTRAINT `facility_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `location` ADD CONSTRAINT `location_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `location` ADD CONSTRAINT `location_organizationId_facilityId_fkey` FOREIGN KEY (`organizationId`, `facilityId`) REFERENCES `facility`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nombres como el SKU: utf8mb4_unicode_ci ignora mayúsculas y acentos.
ALTER TABLE `facility` ADD CONSTRAINT `facility_name_check` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0);
ALTER TABLE `location` ADD CONSTRAINT `location_name_check` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0);
-- NULL deja sitio para varias ubicaciones ordinarias en INV-14. Solo true
-- ocupa el único lugar por defecto; false no es una representación válida.
ALTER TABLE `location` ADD CONSTRAINT `location_default_check` CHECK (
    `isDefault` IS NULL OR (`isDefault` = 1 AND CAST(`name` AS BINARY) = _binary'General')
);

-- Backfill sin ejecutar código de aplicación. newId() guarda UUIDv7 como
-- CHAR(36), no BINARY(16). UUID() de MySQL genera v1 y por eso no se usa.
-- Construimos v7: 48 bits de milisegundos Unix, versión 7, variante 10xx
-- (nibble 8) y 72 bits aleatorios de RANDOM_BYTES por fila. No se reutilizan
-- ids de empresa. El prefijo temporal es común, la parte aleatoria no.
SET @locations_uuid_time = LPAD(HEX(CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED)), 12, '0');

START TRANSACTION;
INSERT INTO `facility` (`id`, `organizationId`, `name`, `createdAt`, `updatedAt`)
SELECT LOWER(CONCAT(
    SUBSTRING(@locations_uuid_time, 1, 8), '-', SUBSTRING(@locations_uuid_time, 9, 4),
    '-7', SUBSTRING(HEX(RANDOM_BYTES(2)), 1, 3),
    '-8', SUBSTRING(HEX(RANDOM_BYTES(2)), 1, 3), '-', HEX(RANDOM_BYTES(6))
)), `id`, 'Principal', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM `organization`;

INSERT INTO `location` (`id`, `organizationId`, `facilityId`, `name`, `isDefault`, `createdAt`, `updatedAt`)
SELECT LOWER(CONCAT(
    SUBSTRING(@locations_uuid_time, 1, 8), '-', SUBSTRING(@locations_uuid_time, 9, 4),
    '-7', SUBSTRING(HEX(RANDOM_BYTES(2)), 1, 3),
    '-8', SUBSTRING(HEX(RANDOM_BYTES(2)), 1, 3), '-', HEX(RANDOM_BYTES(6))
)), `organizationId`, `id`, 'General', true, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM `facility`;
COMMIT;
