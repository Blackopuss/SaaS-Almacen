-- CreateTable
CREATE TABLE `sales_order` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL,
    `status` ENUM('OPEN', 'PARTIAL', 'FULFILLED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `quoteId` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `pricesIncludeTax` BOOLEAN NOT NULL,
    `taxRate` DECIMAL(5, 2) NOT NULL,
    `discountPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `discountReason` VARCHAR(200) NULL,
    `notes` VARCHAR(1000) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_order_organizationId_status_createdAt_idx`(`organizationId`, `status`, `createdAt`),
    INDEX `sales_order_organizationId_customerId_createdAt_idx`(`organizationId`, `customerId`, `createdAt`),
    UNIQUE INDEX `sales_order_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_order_organizationId_number_key`(`organizationId`, `number`),
    UNIQUE INDEX `sales_order_organizationId_quoteId_key`(`organizationId`, `quoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_order_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `lineNumber` INTEGER NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `capturedQuantity` DECIMAL(12, 3) NOT NULL,
    `presentationId` CHAR(36) NULL,
    `presentationVersionId` CHAR(36) NULL,
    `factor` DECIMAL(18, 6) NOT NULL,
    `baseQuantity` DECIMAL(12, 3) NOT NULL,
    `unitCode` VARCHAR(12) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(14, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_order_line_organizationId_productId_idx`(`organizationId`, `productId`),
    UNIQUE INDEX `sales_order_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_order_line_organizationId_orderId_lineNumber_key`(`organizationId`, `orderId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_order` ADD CONSTRAINT `sales_order_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order` ADD CONSTRAINT `sales_order_organizationId_quoteId_fkey` FOREIGN KEY (`organizationId`, `quoteId`) REFERENCES `sales_quote`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order` ADD CONSTRAINT `sales_order_organizationId_customerId_fkey` FOREIGN KEY (`organizationId`, `customerId`) REFERENCES `contact`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_line` ADD CONSTRAINT `sales_order_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_line` ADD CONSTRAINT `sales_order_line_organizationId_orderId_fkey` FOREIGN KEY (`organizationId`, `orderId`) REFERENCES `sales_order`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_line` ADD CONSTRAINT `sales_order_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_order_line` ADD CONSTRAINT `sales_order_line_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sales_order_line` ADD CONSTRAINT `sales_order_line_organizationId_presentationId_presentation_fkey` FOREIGN KEY (`organizationId`, `presentationId`, `presentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Como su cotización: número, tasa y descuento con forma (COT-05).
ALTER TABLE `sales_order` ADD CONSTRAINT `sales_order_values_check` CHECK (
    `number` >= 1
    AND `taxRate` >= 0 AND `taxRate` <= 100
    AND `discountPercent` >= 0 AND `discountPercent` <= 100
    AND (`discountPercent` = 0 OR (`discountReason` IS NOT NULL AND CHAR_LENGTH(`discountReason`) > 0))
    AND (`notes` IS NULL OR CHAR_LENGTH(`notes`) > 0)
);

ALTER TABLE `sales_order_line` ADD CONSTRAINT `sales_order_line_quantities_check` CHECK (
    `capturedQuantity` > 0 AND `factor` > 0 AND `baseQuantity` > 0
    AND `baseQuantity` = `capturedQuantity` * `factor`
    AND `lineNumber` >= 1
);

ALTER TABLE `sales_order_line` ADD CONSTRAINT `sales_order_line_amount_check` CHECK (
    `unitPrice` >= 0 AND `discount` >= 0 AND `amount` >= 0
    AND `amount` = ROUND(`capturedQuantity` * `unitPrice`, 2) - `discount`
);

ALTER TABLE `sales_order_line` ADD CONSTRAINT `sales_order_line_capture_check` CHECK (
    (`presentationId` IS NULL AND `presentationVersionId` IS NULL AND `factor` = 1)
    OR (`presentationId` IS NOT NULL AND `presentationVersionId` IS NOT NULL)
);

-- Un pedido nace abierto, de una cotización aceptada y para su mismo
-- cliente; no se borra, y lo que se acordó (cotización, cliente, precios,
-- IVA, descuento, notas) no cambia.
CREATE TRIGGER `sales_order_insert_rules` BEFORE INSERT ON `sales_order` FOR EACH ROW
BEGIN
    IF NEW.`status` <> 'OPEN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: an order is created open';
    END IF;
    IF COALESCE((SELECT `status` FROM `sales_quote` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`quoteId`), 'NONE') <> 'ACCEPTED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: the quote is not accepted';
    END IF;
    IF NEW.`customerId` <> (SELECT `customerId` FROM `sales_quote` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`quoteId`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: the customer is not the one of the quote';
    END IF;
END;

CREATE TRIGGER `sales_order_update_rules` BEFORE UPDATE ON `sales_order` FOR EACH ROW
BEGIN
    IF NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`number` <> OLD.`number`
        OR NEW.`quoteId` <> OLD.`quoteId`
        OR NEW.`customerId` <> OLD.`customerId`
        OR NEW.`pricesIncludeTax` <> OLD.`pricesIncludeTax`
        OR NEW.`taxRate` <> OLD.`taxRate`
        OR NEW.`discountPercent` <> OLD.`discountPercent`
        OR NOT (NEW.`discountReason` <=> OLD.`discountReason`)
        OR NOT (NEW.`notes` <=> OLD.`notes`)
        OR NEW.`createdByUserId` <> OLD.`createdByUserId`
        OR NEW.`createdAt` <> OLD.`createdAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: what was agreed cannot change';
    END IF;
END;

CREATE TRIGGER `sales_order_no_delete` BEFORE DELETE ON `sales_order` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order cannot be deleted';

-- Sus líneas se escriben al nacer el pedido, en la unidad del producto, y
-- ya no cambian.
CREATE TRIGGER `sales_order_line_insert_rules` BEFORE INSERT ON `sales_order_line` FOR EACH ROW
BEGIN
    IF COALESCE((SELECT `status` FROM `sales_order` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`orderId`), 'NONE') <> 'OPEN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order_line: the order is not open';
    END IF;
    IF NEW.`unitCode` <> (SELECT `unitCode` FROM `product` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`productId`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order_line: unitCode is not the unit of the product';
    END IF;
END;
CREATE TRIGGER `sales_order_line_no_update` BEFORE UPDATE ON `sales_order_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order_line is immutable';
CREATE TRIGGER `sales_order_line_no_delete` BEFORE DELETE ON `sales_order_line` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order_line is immutable';
