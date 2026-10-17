-- AlterTable
ALTER TABLE `stock_movement` MODIFY `type` ENUM('ENTRY', 'EXIT', 'TRANSFER', 'ADJUSTMENT', 'INITIAL', 'REVERSAL', 'RECEIPT', 'RETURN') NOT NULL;

-- CreateTable
CREATE TABLE `purchase_return` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `receiptId` CHAR(36) NOT NULL,
    `movementId` CHAR(36) NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `returnedByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_return_organizationId_receiptId_createdAt_idx`(`organizationId`, `receiptId`, `createdAt`),
    UNIQUE INDEX `purchase_return_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `purchase_return_organizationId_movementId_key`(`organizationId`, `movementId`),
    UNIQUE INDEX `purchase_return_organizationId_idempotencyKey_key`(`organizationId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_return_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `returnId` CHAR(36) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `receiptLineId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `locationId` CHAR(36) NOT NULL,
    `capturedQuantity` DECIMAL(12, 3) NOT NULL,
    `factor` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(12, 3) NOT NULL,
    `unitCode` VARCHAR(12) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_return_line_organizationId_receiptLineId_idx`(`organizationId`, `receiptLineId`),
    INDEX `purchase_return_line_organizationId_productId_createdAt_idx`(`organizationId`, `productId`, `createdAt`),
    UNIQUE INDEX `purchase_return_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `purchase_return_line_organizationId_returnId_lineNumber_key`(`organizationId`, `returnId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `purchase_return` ADD CONSTRAINT `purchase_return_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return` ADD CONSTRAINT `purchase_return_organizationId_receiptId_fkey` FOREIGN KEY (`organizationId`, `receiptId`) REFERENCES `purchase_receipt`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return` ADD CONSTRAINT `purchase_return_organizationId_movementId_fkey` FOREIGN KEY (`organizationId`, `movementId`) REFERENCES `stock_movement`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_line` ADD CONSTRAINT `purchase_return_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_line` ADD CONSTRAINT `purchase_return_line_organizationId_returnId_fkey` FOREIGN KEY (`organizationId`, `returnId`) REFERENCES `purchase_return`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_line` ADD CONSTRAINT `purchase_return_line_organizationId_receiptLineId_fkey` FOREIGN KEY (`organizationId`, `receiptLineId`) REFERENCES `purchase_receipt_line`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_line` ADD CONSTRAINT `purchase_return_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_return_line` ADD CONSTRAINT `purchase_return_line_organizationId_locationId_fkey` FOREIGN KEY (`organizationId`, `locationId`) REFERENCES `location`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cantidades positivas y la equivalencia exacta: base = devuelta × factor.
ALTER TABLE `purchase_return_line` ADD CONSTRAINT `purchase_return_line_quantities_check` CHECK (
    `capturedQuantity` > 0 AND `factor` > 0 AND `baseQuantity` > 0
    AND `baseQuantity` = `capturedQuantity` * `factor`
    AND `lineNumber` >= 1
);
ALTER TABLE `purchase_return` ADD CONSTRAINT `purchase_return_reason_check` CHECK (
    CHAR_LENGTH(TRIM(`reason`)) > 0
);

-- Una devolución es historia: no se edita ni se borra.
CREATE TRIGGER `purchase_return_no_update` BEFORE UPDATE ON `purchase_return` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_return is immutable';
CREATE TRIGGER `purchase_return_no_delete` BEFORE DELETE ON `purchase_return` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_return is immutable';
CREATE TRIGGER `purchase_return_line_no_update` BEFORE UPDATE ON `purchase_return_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_return_line is immutable';
CREATE TRIGGER `purchase_return_line_no_delete` BEFORE DELETE ON `purchase_return_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_return_line is immutable';

-- Su movimiento es una devolución.
CREATE TRIGGER `purchase_return_movement` BEFORE INSERT ON `purchase_return` FOR EACH ROW
BEGIN
    IF (SELECT `type` FROM `stock_movement` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`movementId`) <> 'RETURN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_return: the movement is not a return';
    END IF;
END;

-- La línea devuelve una línea de la misma recepción, del mismo producto,
-- con el factor con que se recibió, y nunca más de lo que se recibió
-- sumando las devoluciones anteriores (última defensa; el servicio lo
-- decide con la orden bloqueada).
CREATE TRIGGER `purchase_return_line_matches_receipt` BEFORE INSERT ON `purchase_return_line` FOR EACH ROW
BEGIN
    DECLARE received DECIMAL(12, 3);
    DECLARE returned DECIMAL(12, 3);
    SELECT rl.`capturedQuantity` INTO received
    FROM `purchase_receipt_line` AS rl
    JOIN `purchase_return` AS r ON r.`organizationId` = NEW.`organizationId` AND r.`id` = NEW.`returnId`
    WHERE rl.`organizationId` = NEW.`organizationId`
        AND rl.`id` = NEW.`receiptLineId`
        AND rl.`receiptId` = r.`receiptId`
        AND rl.`productId` = NEW.`productId`
        AND rl.`factor` = NEW.`factor`
        AND rl.`unitCode` = NEW.`unitCode`;
    IF received IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_return_line: not a line of the receipt, or another product, factor or unit';
    END IF;
    SELECT COALESCE(SUM(`capturedQuantity`), 0) INTO returned
    FROM `purchase_return_line`
    WHERE `organizationId` = NEW.`organizationId` AND `receiptLineId` = NEW.`receiptLineId`;
    IF returned + NEW.`capturedQuantity` > received THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_return_line: more than what was received';
    END IF;
END;
