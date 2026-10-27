-- AlterTable
ALTER TABLE `stock_movement_line` ADD COLUMN `unitCost` DECIMAL(18, 6) NULL;

-- CreateTable
CREATE TABLE `product_cost` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `averageCost` DECIMAL(18, 6) NOT NULL,
    `stockValue` DECIMAL(20, 6) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_cost_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `product_cost_organizationId_productId_key`(`organizationId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_cost` ADD CONSTRAINT `product_cost_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_cost` ADD CONSTRAINT `product_cost_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- VAL-01 (ADR 0031): costos nunca negativos. Solo expansión: la versión
-- anterior ignora la columna y la tabla nuevas.
ALTER TABLE `stock_movement_line`
  ADD CONSTRAINT `stock_movement_line_unit_cost` CHECK (`unitCost` IS NULL OR `unitCost` >= 0);
ALTER TABLE `product_cost`
  ADD CONSTRAINT `product_cost_amounts` CHECK (`averageCost` >= 0 AND `stockValue` >= 0);
