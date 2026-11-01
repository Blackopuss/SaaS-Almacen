-- AlterTable
ALTER TABLE `stock_movement` MODIFY `type` ENUM('ENTRY', 'EXIT', 'TRANSFER', 'ADJUSTMENT', 'INITIAL', 'REVERSAL', 'RECEIPT', 'RETURN', 'SALE', 'SALE_RETURN') NOT NULL;

-- CreateTable
CREATE TABLE `sale_return` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `saleId` CHAR(36) NOT NULL,
    `movementId` CHAR(36) NOT NULL,
    `refundMethod` ENUM('CASH', 'CARD', 'TRANSFER') NOT NULL,
    `refund` DECIMAL(14, 2) NOT NULL,
    `reference` VARCHAR(60) NULL,
    `cashSessionId` CHAR(36) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `cancelsSale` BOOLEAN NOT NULL DEFAULT false,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sale_return_organizationId_saleId_idx`(`organizationId`, `saleId`),
    INDEX `sale_return_organizationId_cashSessionId_idx`(`organizationId`, `cashSessionId`),
    UNIQUE INDEX `sale_return_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sale_return_organizationId_movementId_key`(`organizationId`, `movementId`),
    UNIQUE INDEX `sale_return_organizationId_idempotencyKey_key`(`organizationId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_return_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `returnId` CHAR(36) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `saleLineId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `locationId` CHAR(36) NOT NULL,
    `capturedQuantity` DECIMAL(12, 3) NOT NULL,
    `presentationId` CHAR(36) NULL,
    `presentationVersionId` CHAR(36) NULL,
    `factor` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(12, 3) NOT NULL,
    `unitCode` VARCHAR(12) NOT NULL,
    `unitCost` DECIMAL(18, 6) NULL,
    `refund` DECIMAL(14, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sale_return_line_organizationId_saleLineId_idx`(`organizationId`, `saleLineId`),
    UNIQUE INDEX `sale_return_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sale_return_line_organizationId_returnId_lineNumber_key`(`organizationId`, `returnId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sale_return` ADD CONSTRAINT `sale_return_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return` ADD CONSTRAINT `sale_return_organizationId_saleId_fkey` FOREIGN KEY (`organizationId`, `saleId`) REFERENCES `sale`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return` ADD CONSTRAINT `sale_return_organizationId_movementId_fkey` FOREIGN KEY (`organizationId`, `movementId`) REFERENCES `stock_movement`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return` ADD CONSTRAINT `sale_return_organizationId_cashSessionId_fkey` FOREIGN KEY (`organizationId`, `cashSessionId`) REFERENCES `cash_session`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_line` ADD CONSTRAINT `sale_return_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_line` ADD CONSTRAINT `sale_return_line_organizationId_returnId_fkey` FOREIGN KEY (`organizationId`, `returnId`) REFERENCES `sale_return`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_line` ADD CONSTRAINT `sale_return_line_organizationId_saleLineId_fkey` FOREIGN KEY (`organizationId`, `saleLineId`) REFERENCES `sale_line`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_line` ADD CONSTRAINT `sale_return_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_line` ADD CONSTRAINT `sale_return_line_organizationId_locationId_fkey` FOREIGN KEY (`organizationId`, `locationId`) REFERENCES `location`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_return_line` ADD CONSTRAINT `sale_return_line_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sale_return_line` ADD CONSTRAINT `sale_return_line_organizationId_presentationId_presentation_fkey` FOREIGN KEY (`organizationId`, `presentationId`, `presentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;



-- VEN-19..21 (ADR 0030): devoluciones y cancelación. Solo expansión.

ALTER TABLE `sale_return` ADD CONSTRAINT `sale_return_check` CHECK (
    `refund` >= 0 AND CHAR_LENGTH(`reason`) > 0
);

ALTER TABLE `sale_return_line` ADD CONSTRAINT `sale_return_line_check` CHECK (
    `capturedQuantity` > 0 AND `factor` > 0 AND `baseQuantity` > 0
    AND `baseQuantity` = `capturedQuantity` * `factor`
    AND `lineNumber` >= 1 AND `refund` >= 0
    AND (
        (`presentationId` IS NULL AND `presentationVersionId` IS NULL AND `factor` = 1)
        OR (`presentationId` IS NOT NULL AND `presentationVersionId` IS NOT NULL)
    )
);

-- Una devolución es historia: no se edita ni se borra.
CREATE TRIGGER `sale_return_no_update` BEFORE UPDATE ON `sale_return` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return is immutable';
CREATE TRIGGER `sale_return_no_delete` BEFORE DELETE ON `sale_return` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return is immutable';
CREATE TRIGGER `sale_return_line_no_update` BEFORE UPDATE ON `sale_return_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return_line is immutable';
CREATE TRIGGER `sale_return_line_no_delete` BEFORE DELETE ON `sale_return_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return_line is immutable';

-- Su movimiento es una devolución de venta; el efectivo sale de la caja
-- abierta de quien la hace, y tarjeta o transferencia no tocan la caja.
CREATE TRIGGER `sale_return_insert_rules` BEFORE INSERT ON `sale_return` FOR EACH ROW
BEGIN
    IF (SELECT `type` FROM `stock_movement` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`movementId`) <> 'SALE_RETURN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return: the movement is not a sale return';
    END IF;
    IF NEW.`refundMethod` = 'CASH' AND NOT EXISTS (
        SELECT 1 FROM `cash_session`
        WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`cashSessionId`
            AND `isOpen` = 1 AND `openedByUserId` = NEW.`createdByUserId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return: cash comes out of the open register of who returns';
    END IF;
    IF NEW.`refundMethod` <> 'CASH' AND NEW.`cashSessionId` IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return: only cash goes through the register';
    END IF;
END;

-- La línea devuelve una línea de esa venta, del mismo producto y su unidad.
CREATE TRIGGER `sale_return_line_matches_sale` BEFORE INSERT ON `sale_return_line` FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `sale_line` AS sl
        JOIN `sale_return` AS r ON r.`organizationId` = NEW.`organizationId` AND r.`id` = NEW.`returnId`
        WHERE sl.`organizationId` = NEW.`organizationId`
            AND sl.`id` = NEW.`saleLineId`
            AND sl.`saleId` = r.`saleId`
            AND sl.`productId` = NEW.`productId`
            AND sl.`presentationId` <=> NEW.`presentationId`
            AND sl.`unitCode` = NEW.`unitCode`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return_line: not a line of the sale, or another product';
    END IF;
END;
