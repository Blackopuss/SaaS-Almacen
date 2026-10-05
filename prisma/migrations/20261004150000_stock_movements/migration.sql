-- Existencias (INV-15): movimientos confirmados, sus líneas y el saldo por
-- producto y ubicación. Cada línea guarda lo capturado, el factor aplicado,
-- la versión de la presentación y la cantidad en la unidad del producto.

-- CreateTable
CREATE TABLE `stock_movement` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `type` ENUM('ENTRY', 'EXIT', 'TRANSFER', 'ADJUSTMENT', 'INITIAL', 'REVERSAL') NOT NULL,
    `reason` VARCHAR(500) NULL,
    `reference` VARCHAR(120) NULL,
    `idempotencyKey` VARCHAR(64) NULL,
    `reversesMovementId` CHAR(36) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_movement_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `stock_movement_organizationId_type_createdAt_idx`(`organizationId`, `type`, `createdAt`),
    INDEX `stock_movement_organizationId_createdByUserId_createdAt_idx`(`organizationId`, `createdByUserId`, `createdAt`),
    UNIQUE INDEX `stock_movement_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `stock_movement_organizationId_idempotencyKey_key`(`organizationId`, `idempotencyKey`),
    UNIQUE INDEX `stock_movement_organizationId_reversesMovementId_key`(`organizationId`, `reversesMovementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_movement_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `movementId` CHAR(36) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `locationId` CHAR(36) NOT NULL,
    `direction` ENUM('IN', 'OUT') NOT NULL,
    `capturedQuantity` DECIMAL(12, 3) NOT NULL,
    `capturedUnitCode` VARCHAR(12) NULL,
    `presentationId` CHAR(36) NULL,
    `presentationVersionId` CHAR(36) NULL,
    `factor` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(12, 3) NOT NULL,
    `unitCode` VARCHAR(12) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_movement_line_organizationId_productId_createdAt_idx`(`organizationId`, `productId`, `createdAt`),
    INDEX `stock_movement_line_organizationId_locationId_createdAt_idx`(`organizationId`, `locationId`, `createdAt`),
    UNIQUE INDEX `stock_movement_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `stock_movement_line_organizationId_movementId_lineNumber_key`(`organizationId`, `movementId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_balance` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `locationId` CHAR(36) NOT NULL,
    `quantity` DECIMAL(18, 3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `stock_balance_organizationId_locationId_idx`(`organizationId`, `locationId`),
    UNIQUE INDEX `stock_balance_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `stock_balance_organizationId_productId_locationId_key`(`organizationId`, `productId`, `locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `presentation_version_organizationId_presentationId_id_key` ON `presentation_version`(`organizationId`, `presentationId`, `id`);

-- CreateIndex
CREATE UNIQUE INDEX `product_presentation_organizationId_productId_id_key` ON `product_presentation`(`organizationId`, `productId`, `id`);

-- AddForeignKey
ALTER TABLE `stock_movement` ADD CONSTRAINT `stock_movement_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movement` ADD CONSTRAINT `stock_movement_organizationId_reversesMovementId_fkey` FOREIGN KEY (`organizationId`, `reversesMovementId`) REFERENCES `stock_movement`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_organizationId_movementId_fkey` FOREIGN KEY (`organizationId`, `movementId`) REFERENCES `stock_movement`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_organizationId_locationId_fkey` FOREIGN KEY (`organizationId`, `locationId`) REFERENCES `location`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_capturedUnitCode_fkey` FOREIGN KEY (`capturedUnitCode`) REFERENCES `unit`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_organizationId_presentationId_presentat_fkey` FOREIGN KEY (`organizationId`, `presentationId`, `presentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_unitCode_fkey` FOREIGN KEY (`unitCode`) REFERENCES `unit`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_balance` ADD CONSTRAINT `stock_balance_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_balance` ADD CONSTRAINT `stock_balance_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_balance` ADD CONSTRAINT `stock_balance_organizationId_locationId_fkey` FOREIGN KEY (`organizationId`, `locationId`) REFERENCES `location`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Una reversa siempre dice qué movimiento deshace, y solo ella lo hace.
ALTER TABLE `stock_movement` ADD CONSTRAINT `stock_movement_reversal_check` CHECK (
    (`type` = 'REVERSAL') = (`reversesMovementId` IS NOT NULL)
);
ALTER TABLE `stock_movement` ADD CONSTRAINT `stock_movement_self_check` CHECK (
    `reversesMovementId` IS NULL OR `reversesMovementId` <> `id`
);

-- Cantidades positivas y la equivalencia exacta: base = capturada × factor.
-- MySQL multiplica decimales sin redondear, así que la igualdad es exacta.
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_quantities_check` CHECK (
    `capturedQuantity` > 0 AND `factor` > 0 AND `baseQuantity` > 0
    AND `baseQuantity` = `capturedQuantity` * `factor`
    AND `lineNumber` >= 1
);
-- Se capturó en la unidad del producto (factor 1), en una presentación con
-- su versión, o en otra unidad; nunca presentación y unidad a la vez.
ALTER TABLE `stock_movement_line` ADD CONSTRAINT `stock_movement_line_capture_check` CHECK (
    (`presentationId` IS NULL AND `presentationVersionId` IS NULL AND `capturedUnitCode` IS NULL AND `factor` = 1)
    OR (`presentationId` IS NOT NULL AND `presentationVersionId` IS NOT NULL AND `capturedUnitCode` IS NULL)
    OR (`presentationId` IS NULL AND `presentationVersionId` IS NULL AND `capturedUnitCode` IS NOT NULL)
);

-- El saldo nunca es negativo, aunque dos salidas lleguen a la vez.
ALTER TABLE `stock_balance` ADD CONSTRAINT `stock_balance_quantity_check` CHECK (`quantity` >= 0);

-- Un movimiento confirmado no se edita ni se borra: se corrige con una reversa.
CREATE TRIGGER `stock_movement_no_update` BEFORE UPDATE ON `stock_movement` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movement is immutable: reverse it instead';
CREATE TRIGGER `stock_movement_no_delete` BEFORE DELETE ON `stock_movement` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movement is immutable: reverse it instead';
CREATE TRIGGER `stock_movement_line_no_update` BEFORE UPDATE ON `stock_movement_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movement_line is immutable: reverse the movement instead';
CREATE TRIGGER `stock_movement_line_no_delete` BEFORE DELETE ON `stock_movement_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movement_line is immutable: reverse the movement instead';

-- La línea guarda la unidad del producto en ese momento, y debe ser la suya.
CREATE TRIGGER `stock_movement_line_unit` BEFORE INSERT ON `stock_movement_line` FOR EACH ROW
BEGIN
    IF NEW.`unitCode` <> (SELECT `unitCode` FROM `product` WHERE `id` = NEW.`productId`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movement_line: unitCode is not the unit of the product';
    END IF;
END;

-- La unidad en la que se controla un producto queda fija con su primer
-- movimiento: cambiarla dejaría sin sentido los saldos ya registrados.
CREATE TRIGGER `product_unit_locked` BEFORE UPDATE ON `product` FOR EACH ROW
BEGIN
    IF NEW.`unitCode` <> OLD.`unitCode`
        AND EXISTS (SELECT 1 FROM `stock_movement_line` WHERE `organizationId` = OLD.`organizationId` AND `productId` = OLD.`id` LIMIT 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'product: the unit cannot change after the first movement';
    END IF;
END;
