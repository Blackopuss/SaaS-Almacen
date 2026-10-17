-- CreateTable
CREATE TABLE `product_presentation` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_presentation_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `product_presentation_organizationId_productId_name_key`(`organizationId`, `productId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `presentation_version` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `presentationId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `factor` DECIMAL(18, 3) NOT NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `presentation_version_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `presentation_version_presentationId_version_key`(`presentationId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_presentation` ADD CONSTRAINT `product_presentation_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_presentation` ADD CONSTRAINT `product_presentation_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `presentation_version` ADD CONSTRAINT `presentation_version_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `presentation_version` ADD CONSTRAINT `presentation_version_organizationId_presentationId_fkey` FOREIGN KEY (`organizationId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- A presentation always contains something, and its versions never change
-- once written (INV-08): history must keep the content it used.
ALTER TABLE `presentation_version`
  ADD CONSTRAINT `presentation_version_values_check` CHECK (`factor` > 0 AND `version` >= 1);
ALTER TABLE `product_presentation`
  ADD CONSTRAINT `product_presentation_name_check` CHECK (CHAR_LENGTH(TRIM(`name`)) > 0);
CREATE TRIGGER `presentation_version_no_update` BEFORE UPDATE ON `presentation_version` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'presentation_version is immutable: create a new version';
CREATE TRIGGER `presentation_version_no_delete` BEFORE DELETE ON `presentation_version` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'presentation_version is immutable: create a new version';
