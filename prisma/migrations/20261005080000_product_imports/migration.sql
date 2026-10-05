-- CreateTable
CREATE TABLE `product_import` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `fileId` CHAR(36) NOT NULL,
    `status` ENUM('MAPPING', 'READY') NOT NULL DEFAULT 'MAPPING',
    `sheetName` VARCHAR(64) NULL,
    `headerRow` INTEGER NOT NULL,
    `headers` JSON NOT NULL,
    `dataRows` INTEGER NOT NULL,
    `formulaCells` INTEGER NOT NULL DEFAULT 0,
    `mapping` JSON NOT NULL,
    `decimalSeparator` CHAR(1) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `product_import_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    UNIQUE INDEX `product_import_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_import` ADD CONSTRAINT `product_import_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_import` ADD CONSTRAINT `product_import_organizationId_fileId_fkey` FOREIGN KEY (`organizationId`, `fileId`) REFERENCES `stored_file`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Decimals are written with a point or a comma; nothing else.
ALTER TABLE `product_import` ADD CONSTRAINT `product_import_decimal_check` CHECK (`decimalSeparator` IS NULL OR `decimalSeparator` IN ('.', ','));
-- An import ready to validate knows how to read its numbers.
ALTER TABLE `product_import` ADD CONSTRAINT `product_import_ready_check` CHECK (`status` = 'MAPPING' OR `decimalSeparator` IS NOT NULL);
