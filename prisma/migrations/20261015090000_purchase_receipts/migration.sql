-- AlterTable
ALTER TABLE `stock_movement` MODIFY `type` ENUM('ENTRY', 'EXIT', 'TRANSFER', 'ADJUSTMENT', 'INITIAL', 'REVERSAL', 'RECEIPT') NOT NULL;

-- CreateTable
CREATE TABLE `purchase_receipt` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `movementId` CHAR(36) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `receivedByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_receipt_organizationId_orderId_createdAt_idx`(`organizationId`, `orderId`, `createdAt`),
    UNIQUE INDEX `purchase_receipt_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `purchase_receipt_organizationId_movementId_key`(`organizationId`, `movementId`),
    UNIQUE INDEX `purchase_receipt_organizationId_idempotencyKey_key`(`organizationId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_receipt_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `receiptId` CHAR(36) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `orderLineId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `locationId` CHAR(36) NOT NULL,
    `capturedQuantity` DECIMAL(12, 3) NOT NULL,
    `presentationId` CHAR(36) NULL,
    `presentationVersionId` CHAR(36) NULL,
    `factor` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(12, 3) NOT NULL,
    `unitCode` VARCHAR(12) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_receipt_line_organizationId_orderLineId_idx`(`organizationId`, `orderLineId`),
    INDEX `purchase_receipt_line_organizationId_productId_createdAt_idx`(`organizationId`, `productId`, `createdAt`),
    UNIQUE INDEX `purchase_receipt_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `purchase_receipt_line_organizationId_receiptId_lineNumber_key`(`organizationId`, `receiptId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `purchase_receipt` ADD CONSTRAINT `purchase_receipt_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipt` ADD CONSTRAINT `purchase_receipt_organizationId_orderId_fkey` FOREIGN KEY (`organizationId`, `orderId`) REFERENCES `purchase_order`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipt` ADD CONSTRAINT `purchase_receipt_organizationId_movementId_fkey` FOREIGN KEY (`organizationId`, `movementId`) REFERENCES `stock_movement`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_organizationId_receiptId_fkey` FOREIGN KEY (`organizationId`, `receiptId`) REFERENCES `purchase_receipt`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_organizationId_orderLineId_fkey` FOREIGN KEY (`organizationId`, `orderLineId`) REFERENCES `purchase_order_line`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_organizationId_locationId_fkey` FOREIGN KEY (`organizationId`, `locationId`) REFERENCES `location`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_organizationId_productId_presentation_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_organizationId_presentationId_present_fkey` FOREIGN KEY (`organizationId`, `presentationId`, `presentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Cantidades positivas y la equivalencia exacta: base = recibida × factor.
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_quantities_check` CHECK (
    `capturedQuantity` > 0 AND `factor` > 0 AND `baseQuantity` > 0
    AND `baseQuantity` = `capturedQuantity` * `factor`
    AND `lineNumber` >= 1
);

-- En la unidad del producto (factor 1) o en una presentación con su versión.
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_capture_check` CHECK (
    (`presentationId` IS NULL AND `presentationVersionId` IS NULL AND `factor` = 1)
    OR (`presentationId` IS NOT NULL AND `presentationVersionId` IS NOT NULL)
);

-- Una recepción es historia: no se edita ni se borra. Lo que llegó de más o
-- mal se corrige desde Compras (devolución), igual que su movimiento.
CREATE TRIGGER `purchase_receipt_no_update` BEFORE UPDATE ON `purchase_receipt` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_receipt is immutable';
CREATE TRIGGER `purchase_receipt_no_delete` BEFORE DELETE ON `purchase_receipt` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_receipt is immutable';
CREATE TRIGGER `purchase_receipt_line_no_update` BEFORE UPDATE ON `purchase_receipt_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_receipt_line is immutable';
CREATE TRIGGER `purchase_receipt_line_no_delete` BEFORE DELETE ON `purchase_receipt_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_receipt_line is immutable';

-- Solo se recibe una orden enviada o recibida en parte, y su movimiento es
-- una recepción.
CREATE TRIGGER `purchase_receipt_order_state` BEFORE INSERT ON `purchase_receipt` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `purchase_order` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`orderId`) NOT IN ('SENT', 'PARTIAL') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_receipt: the order is not waiting to be received';
    END IF;
    IF (SELECT `type` FROM `stock_movement` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`movementId`) <> 'RECEIPT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_receipt: the movement is not a receipt';
    END IF;
END;

-- La línea recibe una línea de la misma orden, del mismo producto y en su
-- misma presentación, en la unidad del producto.
CREATE TRIGGER `purchase_receipt_line_matches_order` BEFORE INSERT ON `purchase_receipt_line` FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `purchase_order_line` AS ol
        JOIN `purchase_receipt` AS r ON r.`organizationId` = NEW.`organizationId` AND r.`id` = NEW.`receiptId`
        WHERE ol.`organizationId` = NEW.`organizationId`
            AND ol.`id` = NEW.`orderLineId`
            AND ol.`orderId` = r.`orderId`
            AND ol.`productId` = NEW.`productId`
            AND ol.`presentationId` <=> NEW.`presentationId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_receipt_line: not a line of the order, or another product or presentation';
    END IF;
    IF NEW.`unitCode` <> (SELECT `unitCode` FROM `product` WHERE `id` = NEW.`productId`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_receipt_line: unitCode is not the unit of the product';
    END IF;
END;
