-- CreateTable
CREATE TABLE `sale_price` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `presentationId` CHAR(36) NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `updatedByUserId` CHAR(36) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sale_price_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sale_price_organizationId_productId_presentationId_key`(`organizationId`, `productId`, `presentationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sale_price` ADD CONSTRAINT `sale_price_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_price` ADD CONSTRAINT `sale_price_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_price` ADD CONSTRAINT `sale_price_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- VEN-03: un precio nunca es negativo. Solo expansión.
ALTER TABLE `sale_price`
  ADD CONSTRAINT `sale_price_amount` CHECK (`price` >= 0);
