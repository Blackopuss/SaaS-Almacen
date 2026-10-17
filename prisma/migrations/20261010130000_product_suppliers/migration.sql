-- CreateTable
CREATE TABLE `product_supplier` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `contactId` CHAR(36) NOT NULL,
    `supplierSku` VARCHAR(64) NULL,
    `presentationId` CHAR(36) NULL,
    `lastCost` DECIMAL(14, 4) NULL,
    `lastCostPresentationId` CHAR(36) NULL,
    `lastCostPresentationVersionId` CHAR(36) NULL,
    `lastCostAt` DATETIME(3) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `product_supplier_organizationId_contactId_productId_idx`(`organizationId`, `contactId`, `productId`),
    UNIQUE INDEX `product_supplier_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `product_supplier_organizationId_productId_contactId_key`(`organizationId`, `productId`, `contactId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_supplier` ADD CONSTRAINT `product_supplier_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_supplier` ADD CONSTRAINT `product_supplier_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_supplier` ADD CONSTRAINT `product_supplier_organizationId_contactId_fkey` FOREIGN KEY (`organizationId`, `contactId`) REFERENCES `contact`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_supplier` ADD CONSTRAINT `product_supplier_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `product_supplier` ADD CONSTRAINT `product_supplier_organizationId_lastCostPresentationId_last_fkey` FOREIGN KEY (`organizationId`, `lastCostPresentationId`, `lastCostPresentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- El código del proveedor, cuando existe, no queda en blanco.
ALTER TABLE `product_supplier` ADD CONSTRAINT `product_supplier_sku_check` CHECK (
    `supplierSku` IS NULL OR CHAR_LENGTH(TRIM(`supplierSku`)) > 0
);

-- El último costo nunca es negativo y viene completo: importe y fecha
-- juntos; la presentación con su versión, y solo si hay costo.
ALTER TABLE `product_supplier` ADD CONSTRAINT `product_supplier_cost_check` CHECK (
    (`lastCost` IS NULL OR `lastCost` >= 0)
    AND (`lastCost` IS NULL) = (`lastCostAt` IS NULL)
    AND (`lastCostPresentationId` IS NULL) = (`lastCostPresentationVersionId` IS NULL)
    AND (`lastCost` IS NOT NULL OR `lastCostPresentationId` IS NULL)
);
