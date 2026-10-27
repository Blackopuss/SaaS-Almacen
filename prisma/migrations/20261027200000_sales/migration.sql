-- AlterTable
ALTER TABLE `stock_movement` MODIFY `type` ENUM('ENTRY', 'EXIT', 'TRANSFER', 'ADJUSTMENT', 'INITIAL', 'REVERSAL', 'RECEIPT', 'RETURN', 'SALE') NOT NULL;

-- CreateTable
CREATE TABLE `sale` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL,
    `status` ENUM('COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'COMPLETED',
    `customerId` CHAR(36) NULL,
    `movementId` CHAR(36) NOT NULL,
    `pricesIncludeTax` BOOLEAN NOT NULL,
    `taxRate` DECIMAL(5, 2) NOT NULL,
    `discount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `subtotal` DECIMAL(14, 2) NOT NULL,
    `tax` DECIMAL(14, 2) NOT NULL,
    `total` DECIMAL(14, 2) NOT NULL,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `soldByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cancelledByUserId` CHAR(36) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(500) NULL,

    INDEX `sale_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `sale_organizationId_soldByUserId_createdAt_idx`(`organizationId`, `soldByUserId`, `createdAt`),
    INDEX `sale_organizationId_customerId_createdAt_idx`(`organizationId`, `customerId`, `createdAt`),
    UNIQUE INDEX `sale_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sale_organizationId_number_key`(`organizationId`, `number`),
    UNIQUE INDEX `sale_organizationId_movementId_key`(`organizationId`, `movementId`),
    UNIQUE INDEX `sale_organizationId_idempotencyKey_key`(`organizationId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `saleId` CHAR(36) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `locationId` CHAR(36) NOT NULL,
    `capturedQuantity` DECIMAL(12, 3) NOT NULL,
    `presentationId` CHAR(36) NULL,
    `presentationVersionId` CHAR(36) NULL,
    `factor` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(12, 3) NOT NULL,
    `unitCode` VARCHAR(12) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(14, 2) NOT NULL,
    `unitCost` DECIMAL(18, 6) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sale_line_organizationId_productId_createdAt_idx`(`organizationId`, `productId`, `createdAt`),
    UNIQUE INDEX `sale_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sale_line_organizationId_saleId_lineNumber_key`(`organizationId`, `saleId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_payment` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `saleId` CHAR(36) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `method` ENUM('CASH', 'CARD', 'TRANSFER') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `received` DECIMAL(14, 2) NULL,
    `changeGiven` DECIMAL(14, 2) NULL,
    `reference` VARCHAR(60) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sale_payment_organizationId_method_createdAt_idx`(`organizationId`, `method`, `createdAt`),
    UNIQUE INDEX `sale_payment_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sale_payment_organizationId_saleId_lineNumber_key`(`organizationId`, `saleId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sale` ADD CONSTRAINT `sale_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale` ADD CONSTRAINT `sale_organizationId_customerId_fkey` FOREIGN KEY (`organizationId`, `customerId`) REFERENCES `contact`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale` ADD CONSTRAINT `sale_organizationId_movementId_fkey` FOREIGN KEY (`organizationId`, `movementId`) REFERENCES `stock_movement`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_organizationId_saleId_fkey` FOREIGN KEY (`organizationId`, `saleId`) REFERENCES `sale`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_organizationId_locationId_fkey` FOREIGN KEY (`organizationId`, `locationId`) REFERENCES `location`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_organizationId_presentationId_presentationVersion_fkey` FOREIGN KEY (`organizationId`, `presentationId`, `presentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sale_payment` ADD CONSTRAINT `sale_payment_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_payment` ADD CONSTRAINT `sale_payment_organizationId_saleId_fkey` FOREIGN KEY (`organizationId`, `saleId`) REFERENCES `sale`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- VEN-05 (ADR 0030): reglas de la venta en la base. Solo expansión.

-- Importes de la venta: nunca negativos y subtotal + IVA = total.
ALTER TABLE `sale` ADD CONSTRAINT `sale_amounts_check` CHECK (
    `number` >= 1
    AND `taxRate` >= 0 AND `taxRate` <= 100
    AND `discount` >= 0 AND `subtotal` >= 0 AND `tax` >= 0
    AND `subtotal` + `tax` = `total`
);

-- Cancelada = con quién, cuándo y por qué; completada, sin nada de eso.
ALTER TABLE `sale` ADD CONSTRAINT `sale_cancel_check` CHECK (
    (`status` = 'COMPLETED' AND `cancelledByUserId` IS NULL AND `cancelledAt` IS NULL AND `cancelReason` IS NULL)
    OR (`status` = 'CANCELLED' AND `cancelledByUserId` IS NOT NULL AND `cancelledAt` IS NOT NULL AND `cancelReason` IS NOT NULL)
);

-- Cantidades positivas, la equivalencia exacta (base = capturada × factor)
-- y el importe: cantidad × precio, en centavos, menos el descuento.
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_quantities_check` CHECK (
    `capturedQuantity` > 0 AND `factor` > 0 AND `baseQuantity` > 0
    AND `baseQuantity` = `capturedQuantity` * `factor`
    AND `lineNumber` >= 1
);

ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_amount_check` CHECK (
    `unitPrice` >= 0 AND `discount` >= 0 AND `amount` >= 0
    AND `amount` = ROUND(`capturedQuantity` * `unitPrice`, 2) - `discount`
);

-- En la unidad del producto (factor 1) o en una presentación con su versión.
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_capture_check` CHECK (
    (`presentationId` IS NULL AND `presentationVersionId` IS NULL AND `factor` = 1)
    OR (`presentationId` IS NOT NULL AND `presentationVersionId` IS NOT NULL)
);

-- Un pago es mayor que cero. En efectivo guarda lo recibido y el cambio
-- (recibido − pago); con tarjeta o transferencia, solo su referencia.
ALTER TABLE `sale_payment` ADD CONSTRAINT `sale_payment_amounts_check` CHECK (
    `amount` > 0 AND `lineNumber` >= 1
    AND (
        (`method` = 'CASH' AND `received` IS NOT NULL AND `changeGiven` IS NOT NULL
            AND `received` >= `amount` AND `changeGiven` = `received` - `amount`
            AND `reference` IS NULL)
        OR (`method` <> 'CASH' AND `received` IS NULL AND `changeGiven` IS NULL)
    )
);

-- Una venta es historia: no se borra, y de ella solo cambia su cancelación
-- (una vez). Líneas y pagos no se editan ni se borran.
CREATE TRIGGER `sale_no_delete` BEFORE DELETE ON `sale` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale is immutable';
CREATE TRIGGER `sale_only_cancel` BEFORE UPDATE ON `sale` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'COMPLETED' OR NEW.`status` <> 'CANCELLED'
        OR NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`number` <> OLD.`number`
        OR NOT (NEW.`customerId` <=> OLD.`customerId`)
        OR NEW.`movementId` <> OLD.`movementId`
        OR NEW.`pricesIncludeTax` <> OLD.`pricesIncludeTax`
        OR NEW.`taxRate` <> OLD.`taxRate`
        OR NEW.`discount` <> OLD.`discount`
        OR NEW.`subtotal` <> OLD.`subtotal`
        OR NEW.`tax` <> OLD.`tax`
        OR NEW.`total` <> OLD.`total`
        OR NEW.`idempotencyKey` <> OLD.`idempotencyKey`
        OR NEW.`soldByUserId` <> OLD.`soldByUserId`
        OR NEW.`createdAt` <> OLD.`createdAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: only a completed sale can be cancelled, once';
    END IF;
END;
CREATE TRIGGER `sale_line_no_update` BEFORE UPDATE ON `sale_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_line is immutable';
CREATE TRIGGER `sale_line_no_delete` BEFORE DELETE ON `sale_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_line is immutable';
CREATE TRIGGER `sale_payment_no_update` BEFORE UPDATE ON `sale_payment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_payment is immutable';
CREATE TRIGGER `sale_payment_no_delete` BEFORE DELETE ON `sale_payment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_payment is immutable';

-- Se crea completada, su movimiento es una venta y su cliente es cliente.
CREATE TRIGGER `sale_insert_rules` BEFORE INSERT ON `sale` FOR EACH ROW
BEGIN
    IF NEW.`status` <> 'COMPLETED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: a sale is created completed';
    END IF;
    IF (SELECT `type` FROM `stock_movement` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`movementId`) <> 'SALE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: the movement is not a sale';
    END IF;
    IF NEW.`customerId` IS NOT NULL AND NOT (
        SELECT `isCustomer` FROM `contact` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`customerId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: the contact is not a customer';
    END IF;
END;

-- La línea va en la unidad del producto.
CREATE TRIGGER `sale_line_unit` BEFORE INSERT ON `sale_line` FOR EACH ROW
BEGIN
    IF NEW.`unitCode` <> (SELECT `unitCode` FROM `product` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`productId`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_line: unitCode is not the unit of the product';
    END IF;
END;
