-- AlterTable
ALTER TABLE `product_import` ADD COLUMN `failedItems` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `finishedAt` DATETIME(3) NULL,
    ADD COLUMN `lastError` VARCHAR(500) NULL,
    ADD COLUMN `processedItems` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `totalItems` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `product_import_item` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `importId` CHAR(36) NOT NULL,
    `position` INTEGER NOT NULL,
    `sku` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(12) NOT NULL,
    `data` JSON NOT NULL,
    `status` ENUM('PENDING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `productId` CHAR(36) NULL,
    `error` VARCHAR(300) NULL,
    `appliedAt` DATETIME(3) NULL,

    INDEX `product_import_item_organizationId_importId_status_position_idx`(`organizationId`, `importId`, `status`, `position`),
    UNIQUE INDEX `product_import_item_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `product_import_item_organizationId_importId_position_key`(`organizationId`, `importId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_import_item` ADD CONSTRAINT `product_import_item_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_import_item` ADD CONSTRAINT `product_import_item_organizationId_importId_fkey` FOREIGN KEY (`organizationId`, `importId`) REFERENCES `product_import`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Progress never passes the total.
ALTER TABLE `product_import` ADD CONSTRAINT `product_import_progress_check` CHECK (`processedItems` BETWEEN 0 AND `totalItems` AND `failedItems` BETWEEN 0 AND `processedItems`);
