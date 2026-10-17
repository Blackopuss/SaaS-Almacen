-- CreateTable
CREATE TABLE `product_category` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_category_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `product_category_organizationId_name_key`(`organizationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_brand` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_brand_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `product_brand_organizationId_name_key`(`organizationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `sku` VARCHAR(64) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `categoryId` CHAR(36) NULL,
    `brandId` CHAR(36) NULL,
    `barcode` VARCHAR(64) NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `product_organizationId_status_name_idx`(`organizationId`, `status`, `name`),
    INDEX `product_organizationId_categoryId_idx`(`organizationId`, `categoryId`),
    INDEX `product_organizationId_brandId_idx`(`organizationId`, `brandId`),
    UNIQUE INDEX `product_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `product_organizationId_sku_key`(`organizationId`, `sku`),
    UNIQUE INDEX `product_organizationId_barcode_key`(`organizationId`, `barcode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_category` ADD CONSTRAINT `product_category_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_brand` ADD CONSTRAINT `product_brand_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product` ADD CONSTRAINT `product_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product` ADD CONSTRAINT `product_organizationId_categoryId_fkey` FOREIGN KEY (`organizationId`, `categoryId`) REFERENCES `product_category`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product` ADD CONSTRAINT `product_organizationId_brandId_fkey` FOREIGN KEY (`organizationId`, `brandId`) REFERENCES `product_brand`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- A product always has a code and a name, also for SQL that skips the
-- application; an empty barcode is stored as NULL, never as ''.
ALTER TABLE `product`
  ADD CONSTRAINT `product_text_check`
  CHECK (CHAR_LENGTH(TRIM(`sku`)) > 0 AND CHAR_LENGTH(TRIM(`name`)) > 0 AND (`barcode` IS NULL OR CHAR_LENGTH(TRIM(`barcode`)) > 0));
ALTER TABLE `product_category`
  ADD CONSTRAINT `product_category_name_check` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0);
ALTER TABLE `product_brand`
  ADD CONSTRAINT `product_brand_name_check` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0);
