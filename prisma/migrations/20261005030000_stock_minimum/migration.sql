-- CreateTable
CREATE TABLE `stock_minimum` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `quantity` DECIMAL(18, 3) NOT NULL,
    `updatedByUserId` CHAR(36) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stock_minimum_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `stock_minimum_organizationId_productId_key`(`organizationId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stock_minimum` ADD CONSTRAINT `stock_minimum_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_minimum` ADD CONSTRAINT `stock_minimum_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- A minimum is a positive quantity; «no minimum» is the absence of the row.
ALTER TABLE `stock_minimum` ADD CONSTRAINT `stock_minimum_quantity_check` CHECK (`quantity` > 0);
