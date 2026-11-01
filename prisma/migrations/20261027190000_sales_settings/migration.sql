-- CreateTable
CREATE TABLE `sales_settings` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `pricesIncludeTax` BOOLEAN NOT NULL DEFAULT true,
    `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 16,
    `updatedByUserId` CHAR(36) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sales_settings_organizationId_key`(`organizationId`),
    UNIQUE INDEX `sales_settings_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_settings` ADD CONSTRAINT `sales_settings_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- VEN-04: la tasa de IVA va de 0 a 100 %. Solo expansión.
ALTER TABLE `sales_settings`
  ADD CONSTRAINT `sales_settings_tax_rate` CHECK (`taxRate` >= 0 AND `taxRate` <= 100);
