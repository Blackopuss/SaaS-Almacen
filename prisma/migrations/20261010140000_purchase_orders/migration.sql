-- CreateTable
CREATE TABLE `purchase_order` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL,
    `contactId` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `expectedOn` DATE NULL,
    `notes` VARCHAR(500) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `purchase_order_organizationId_status_number_idx`(`organizationId`, `status`, `number`),
    INDEX `purchase_order_organizationId_contactId_number_idx`(`organizationId`, `contactId`, `number`),
    UNIQUE INDEX `purchase_order_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `purchase_order_organizationId_number_key`(`organizationId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_order_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `supplierSku` VARCHAR(64) NULL,
    `capturedQuantity` DECIMAL(12, 3) NOT NULL,
    `presentationId` CHAR(36) NULL,
    `presentationVersionId` CHAR(36) NULL,
    `factor` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(12, 3) NOT NULL,
    `unitCode` VARCHAR(12) NOT NULL,
    `unitCost` DECIMAL(14, 4) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `purchase_order_line_organizationId_productId_orderId_idx`(`organizationId`, `productId`, `orderId`),
    UNIQUE INDEX `purchase_order_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `purchase_order_line_organizationId_orderId_lineNumber_key`(`organizationId`, `orderId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `purchase_order` ADD CONSTRAINT `purchase_order_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order` ADD CONSTRAINT `purchase_order_organizationId_contactId_fkey` FOREIGN KEY (`organizationId`, `contactId`) REFERENCES `contact`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_line` ADD CONSTRAINT `purchase_order_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_line` ADD CONSTRAINT `purchase_order_line_organizationId_orderId_fkey` FOREIGN KEY (`organizationId`, `orderId`) REFERENCES `purchase_order`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_line` ADD CONSTRAINT `purchase_order_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_line` ADD CONSTRAINT `purchase_order_line_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchase_order_line` ADD CONSTRAINT `purchase_order_line_organizationId_presentationId_presentat_fkey` FOREIGN KEY (`organizationId`, `presentationId`, `presentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- El número de la orden empieza en 1.
ALTER TABLE `purchase_order` ADD CONSTRAINT `purchase_order_number_check` CHECK (`number` >= 1);

-- Cantidades positivas y la equivalencia exacta: base = capturada × factor.
ALTER TABLE `purchase_order_line` ADD CONSTRAINT `purchase_order_line_quantities_check` CHECK (
    `capturedQuantity` > 0 AND `factor` > 0 AND `baseQuantity` > 0
    AND `baseQuantity` = `capturedQuantity` * `factor`
    AND `lineNumber` >= 1
);

-- Se pidió en la unidad del producto (factor 1) o en una presentación con
-- su versión; nunca una sin la otra.
ALTER TABLE `purchase_order_line` ADD CONSTRAINT `purchase_order_line_capture_check` CHECK (
    (`presentationId` IS NULL AND `presentationVersionId` IS NULL AND `factor` = 1)
    OR (`presentationId` IS NOT NULL AND `presentationVersionId` IS NOT NULL)
);

-- El costo, cuando se conoce, nunca es negativo.
ALTER TABLE `purchase_order_line` ADD CONSTRAINT `purchase_order_line_cost_check` CHECK (
    `unitCost` IS NULL OR `unitCost` >= 0
);
