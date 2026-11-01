
-- CreateTable
CREATE TABLE `sales_quote` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `customerId` CHAR(36) NOT NULL,
    `validUntil` DATE NOT NULL,
    `pricesIncludeTax` BOOLEAN NOT NULL,
    `taxRate` DECIMAL(5, 2) NOT NULL,
    `discountPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `discountReason` VARCHAR(200) NULL,
    `notes` VARCHAR(1000) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decidedByUserId` CHAR(36) NULL,
    `rejectReason` VARCHAR(500) NULL,

    INDEX `sales_quote_organizationId_status_validUntil_idx`(`organizationId`, `status`, `validUntil`),
    INDEX `sales_quote_organizationId_customerId_createdAt_idx`(`organizationId`, `customerId`, `createdAt`),
    UNIQUE INDEX `sales_quote_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_quote_organizationId_number_key`(`organizationId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_quote_line` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `quoteId` CHAR(36) NOT NULL,
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

    INDEX `sales_quote_line_organizationId_productId_idx`(`organizationId`, `productId`),
    UNIQUE INDEX `sales_quote_line_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_quote_line_organizationId_quoteId_lineNumber_key`(`organizationId`, `quoteId`, `lineNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_quote` ADD CONSTRAINT `sales_quote_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_quote` ADD CONSTRAINT `sales_quote_organizationId_customerId_fkey` FOREIGN KEY (`organizationId`, `customerId`) REFERENCES `contact`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_quote_line` ADD CONSTRAINT `sales_quote_line_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_quote_line` ADD CONSTRAINT `sales_quote_line_organizationId_quoteId_fkey` FOREIGN KEY (`organizationId`, `quoteId`) REFERENCES `sales_quote`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_quote_line` ADD CONSTRAINT `sales_quote_line_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_quote_line` ADD CONSTRAINT `sales_quote_line_organizationId_productId_presentationId_fkey` FOREIGN KEY (`organizationId`, `productId`, `presentationId`) REFERENCES `product_presentation`(`organizationId`, `productId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sales_quote_line` ADD CONSTRAINT `sales_quote_line_organizationId_presentationId_presentation_fkey` FOREIGN KEY (`organizationId`, `presentationId`, `presentationVersionId`) REFERENCES `presentation_version`(`organizationId`, `presentationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Número, tasa, descuento y textos con forma (COT-01).
ALTER TABLE `sales_quote` ADD CONSTRAINT `sales_quote_values_check` CHECK (
    `number` >= 1
    AND `taxRate` >= 0 AND `taxRate` <= 100
    AND `discountPercent` >= 0 AND `discountPercent` <= 100
    AND (`discountPercent` = 0 OR (`discountReason` IS NOT NULL AND CHAR_LENGTH(`discountReason`) > 0))
    AND (`notes` IS NULL OR CHAR_LENGTH(`notes`) > 0)
);

-- Cada estado con lo suyo: el borrador no se ha enviado; aceptada o
-- rechazada dicen cuándo y quién lo registró; solo la rechazada lleva motivo.
ALTER TABLE `sales_quote` ADD CONSTRAINT `sales_quote_status_check` CHECK (
    (`status` = 'DRAFT' AND `sentAt` IS NULL AND `decidedAt` IS NULL AND `decidedByUserId` IS NULL AND `rejectReason` IS NULL)
    OR (`status` = 'SENT' AND `sentAt` IS NOT NULL AND `decidedAt` IS NULL AND `decidedByUserId` IS NULL AND `rejectReason` IS NULL)
    OR (`status` = 'ACCEPTED' AND `sentAt` IS NOT NULL AND `decidedAt` IS NOT NULL AND `decidedByUserId` IS NOT NULL AND `rejectReason` IS NULL)
    OR (`status` = 'REJECTED' AND `sentAt` IS NOT NULL AND `decidedAt` IS NOT NULL AND `decidedByUserId` IS NOT NULL)
);

-- Como en una venta: cantidades positivas, base = capturada × factor y el
-- importe en centavos menos el descuento.
ALTER TABLE `sales_quote_line` ADD CONSTRAINT `sales_quote_line_quantities_check` CHECK (
    `capturedQuantity` > 0 AND `factor` > 0 AND `baseQuantity` > 0
    AND `baseQuantity` = `capturedQuantity` * `factor`
    AND `lineNumber` >= 1
);

ALTER TABLE `sales_quote_line` ADD CONSTRAINT `sales_quote_line_amount_check` CHECK (
    `unitPrice` >= 0 AND `discount` >= 0 AND `amount` >= 0
    AND `amount` = ROUND(`capturedQuantity` * `unitPrice`, 2) - `discount`
);

ALTER TABLE `sales_quote_line` ADD CONSTRAINT `sales_quote_line_capture_check` CHECK (
    (`presentationId` IS NULL AND `presentationVersionId` IS NULL AND `factor` = 1)
    OR (`presentationId` IS NOT NULL AND `presentationVersionId` IS NOT NULL)
);

-- Una cotización no se borra; nace borrador y su cliente es cliente.
CREATE TRIGGER `sales_quote_no_delete` BEFORE DELETE ON `sales_quote` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote cannot be deleted';

CREATE TRIGGER `sales_quote_insert_rules` BEFORE INSERT ON `sales_quote` FOR EACH ROW
BEGIN
    IF NEW.`status` <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote: a quote is created as a draft';
    END IF;
    IF NOT (
        SELECT `isCustomer` FROM `contact` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`customerId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote: the contact is not a customer';
    END IF;
END;

-- Su número, quién la hizo y cuándo no cambian; lo que se le ofrece al
-- cliente (cliente, vigencia, IVA, descuento, notas) solo mientras es borrador.
CREATE TRIGGER `sales_quote_update_rules` BEFORE UPDATE ON `sales_quote` FOR EACH ROW
BEGIN
    IF NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`number` <> OLD.`number`
        OR NEW.`createdByUserId` <> OLD.`createdByUserId`
        OR NEW.`createdAt` <> OLD.`createdAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote: number and author cannot change';
    END IF;
    IF OLD.`status` <> 'DRAFT' AND (
        NEW.`customerId` <> OLD.`customerId`
        OR NEW.`validUntil` <> OLD.`validUntil`
        OR NEW.`pricesIncludeTax` <> OLD.`pricesIncludeTax`
        OR NEW.`taxRate` <> OLD.`taxRate`
        OR NEW.`discountPercent` <> OLD.`discountPercent`
        OR NOT (NEW.`discountReason` <=> OLD.`discountReason`)
        OR NOT (NEW.`notes` <=> OLD.`notes`)
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote: only a draft can be changed';
    END IF;
    IF NEW.`customerId` <> OLD.`customerId` AND NOT (
        SELECT `isCustomer` FROM `contact` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`customerId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote: the contact is not a customer';
    END IF;
END;

-- Las líneas solo cambian mientras su cotización es un borrador, y van en
-- la unidad del producto.
CREATE TRIGGER `sales_quote_line_draft_insert` BEFORE INSERT ON `sales_quote_line` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `sales_quote` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`quoteId`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_line: the quote is not a draft';
    END IF;
    IF NEW.`unitCode` <> (SELECT `unitCode` FROM `product` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`productId`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_line: unitCode is not the unit of the product';
    END IF;
END;

CREATE TRIGGER `sales_quote_line_draft_update` BEFORE UPDATE ON `sales_quote_line` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `sales_quote` WHERE `organizationId` = OLD.`organizationId` AND `id` = OLD.`quoteId`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_line: the quote is not a draft';
    END IF;
    IF NEW.`quoteId` <> OLD.`quoteId` OR NEW.`productId` <> OLD.`productId` OR NEW.`unitCode` <> OLD.`unitCode` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_line: quote, product and unit cannot change';
    END IF;
END;

CREATE TRIGGER `sales_quote_line_draft_delete` BEFORE DELETE ON `sales_quote_line` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `sales_quote` WHERE `organizationId` = OLD.`organizationId` AND `id` = OLD.`quoteId`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_line: the quote is not a draft';
    END IF;
END;
