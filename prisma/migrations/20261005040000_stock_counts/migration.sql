-- CreateTable
CREATE TABLE `stock_count` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `locationId` CHAR(36) NOT NULL,
    `status` ENUM('OPEN', 'APPLIED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `openLocationId` CHAR(36) NULL,
    `note` VARCHAR(200) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedByUserId` CHAR(36) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `closedByUserId` CHAR(36) NULL,

    INDEX `stock_count_organizationId_status_startedAt_idx`(`organizationId`, `status`, `startedAt`),
    UNIQUE INDEX `stock_count_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `stock_count_organizationId_openLocationId_key`(`organizationId`, `openLocationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_count_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `countId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `countedAt` DATETIME(3) NOT NULL,
    `systemQuantity` DECIMAL(18, 3) NOT NULL,
    `unitCode` VARCHAR(12) NOT NULL,

    UNIQUE INDEX `stock_count_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `stock_count_line_organizationId_countId_productId_key`(`organizationId`, `countId`, `productId`),
    UNIQUE INDEX `stock_count_line_organizationId_productId_id_key`(`organizationId`, `productId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_count_capture` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `lineId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `capturedQuantity` DECIMAL(12, 3) NOT NULL,
    `capturedUnitCode` VARCHAR(12) NULL,
    `presentationId` CHAR(36) NULL,
    `presentationVersionId` CHAR(36) NULL,
    `factor` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(12, 3) NOT NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_count_capture_organizationId_lineId_idx`(`organizationId`, `lineId`),
    UNIQUE INDEX `stock_count_capture_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stock_count` ADD CONSTRAINT `stock_count_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count` ADD CONSTRAINT `stock_count_organizationId_locationId_fkey` FOREIGN KEY (`organizationId`, `locationId`) REFERENCES `location`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_line` ADD CONSTRAINT `stock_count_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_line` ADD CONSTRAINT `stock_count_line_organizationId_countId_fkey` FOREIGN KEY (`organizationId`, `countId`) REFERENCES `stock_count`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_line` ADD CONSTRAINT `stock_count_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_capture` ADD CONSTRAINT `stock_count_capture_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_capture` ADD CONSTRAINT `stock_count_capture_organizationId_productId_lineId_fkey` FOREIGN KEY (`organizationId`, `productId`, `lineId`) REFERENCES `stock_count_line`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_count_capture` ADD CONSTRAINT `stock_count_capture_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_count_capture` ADD CONSTRAINT `stock_count_capture_organizationId_presentationId_presentat_fkey` FOREIGN KEY (`organizationId`, `presentationId`, `presentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- An open count holds its location (one open count per location); a
-- closed one releases it and says when it was closed.
ALTER TABLE `stock_count` ADD CONSTRAINT `stock_count_open_check` CHECK ((`status` = 'OPEN') = (`openLocationId` IS NOT NULL));
ALTER TABLE `stock_count` ADD CONSTRAINT `stock_count_closed_check` CHECK ((`status` = 'OPEN') = (`closedAt` IS NULL));

-- What the system had is never negative.
ALTER TABLE `stock_count_line` ADD CONSTRAINT `stock_count_line_system_check` CHECK (`systemQuantity` >= 0);

-- Counting nothing is a valid capture; the conversion is exact.
ALTER TABLE `stock_count_capture` ADD CONSTRAINT `stock_count_capture_quantity_check` CHECK (`capturedQuantity` >= 0 AND `factor` > 0);
ALTER TABLE `stock_count_capture` ADD CONSTRAINT `stock_count_capture_base_check` CHECK (`baseQuantity` = `capturedQuantity` * `factor`);
