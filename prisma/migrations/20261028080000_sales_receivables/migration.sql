-- AlterTable
ALTER TABLE `sales_order` ADD COLUMN `downPayment` DECIMAL(14, 2) NULL,
    ADD COLUMN `installmentInterestPercent` DECIMAL(5, 2) NULL,
    ADD COLUMN `installmentMonths` INTEGER NULL;

-- CreateTable
CREATE TABLE `sales_receivable` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL,
    `status` ENUM('OPEN', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `saleId` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `downPayment` DECIMAL(14, 2) NOT NULL,
    `financed` DECIMAL(14, 2) NOT NULL,
    `interestPercent` DECIMAL(5, 2) NOT NULL,
    `interest` DECIMAL(14, 2) NOT NULL,
    `owed` DECIMAL(14, 2) NOT NULL,
    `months` INTEGER NOT NULL,
    `startDay` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_receivable_organizationId_customerId_createdAt_idx`(`organizationId`, `customerId`, `createdAt`),
    INDEX `sales_receivable_organizationId_status_createdAt_idx`(`organizationId`, `status`, `createdAt`),
    UNIQUE INDEX `sales_receivable_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_receivable_organizationId_number_key`(`organizationId`, `number`),
    UNIQUE INDEX `sales_receivable_organizationId_saleId_key`(`organizationId`, `saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_receivable_installment` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `receivableId` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL,
    `dueDay` DATE NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,

    INDEX `sales_receivable_installment_organizationId_dueDay_idx`(`organizationId`, `dueDay`),
    UNIQUE INDEX `sales_receivable_installment_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_receivable_installment_organizationId_receivableId_num_key`(`organizationId`, `receivableId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_receivable` ADD CONSTRAINT `sales_receivable_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable` ADD CONSTRAINT `sales_receivable_organizationId_saleId_fkey` FOREIGN KEY (`organizationId`, `saleId`) REFERENCES `sale`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable` ADD CONSTRAINT `sales_receivable_organizationId_customerId_fkey` FOREIGN KEY (`organizationId`, `customerId`) REFERENCES `contact`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable_installment` ADD CONSTRAINT `sales_receivable_installment_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable_installment` ADD CONSTRAINT `sales_receivable_installment_organizationId_receivableId_fkey` FOREIGN KEY (`organizationId`, `receivableId`) REFERENCES `sales_receivable`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- PAG-04 (ADR 0030): venta a plazos. El pedido guarda el plan aceptado; al
-- cobrar el enganche nace la cuenta por cobrar con su calendario. Solo
-- expansión.

ALTER TABLE `sales_order` ADD CONSTRAINT `sales_order_plan_check` CHECK (
    (`installmentMonths` IS NULL AND `installmentInterestPercent` IS NULL AND `downPayment` IS NULL)
    OR (`installmentMonths` IS NOT NULL AND `installmentInterestPercent` IS NOT NULL AND `downPayment` IS NOT NULL
        AND `installmentMonths` >= 1 AND `installmentMonths` <= 60
        AND `installmentInterestPercent` >= 0 AND `installmentInterestPercent` <= 100
        AND `downPayment` >= 0)
);

-- Cuenta: debe = financiado + interés; enganche y montos no negativos.
ALTER TABLE `sales_receivable` ADD CONSTRAINT `sales_receivable_check` CHECK (
    `number` >= 1 AND `months` >= 1 AND `months` <= 60
    AND `downPayment` >= 0 AND `financed` > 0 AND `interest` >= 0
    AND `interestPercent` >= 0 AND `interestPercent` <= 100
    AND `owed` = `financed` + `interest`
);
ALTER TABLE `sales_receivable_installment` ADD CONSTRAINT `sales_receivable_installment_check` CHECK (
    `number` >= 1 AND `amount` > 0
);

-- Una cuenta no se borra; de ella solo cambia su estado. Sus mensualidades
-- no cambian ni se borran.
CREATE TRIGGER `sales_receivable_no_delete` BEFORE DELETE ON `sales_receivable` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable cannot be deleted';
CREATE TRIGGER `sales_receivable_only_status` BEFORE UPDATE ON `sales_receivable` FOR EACH ROW
BEGIN
    IF NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`number` <> OLD.`number`
        OR NEW.`saleId` <> OLD.`saleId`
        OR NEW.`customerId` <> OLD.`customerId`
        OR NEW.`downPayment` <> OLD.`downPayment`
        OR NEW.`financed` <> OLD.`financed`
        OR NEW.`interestPercent` <> OLD.`interestPercent`
        OR NEW.`interest` <> OLD.`interest`
        OR NEW.`owed` <> OLD.`owed`
        OR NEW.`months` <> OLD.`months`
        OR NEW.`startDay` <> OLD.`startDay`
        OR NEW.`createdAt` <> OLD.`createdAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable: only its status changes';
    END IF;
    IF NEW.`status` <> OLD.`status` AND OLD.`status` <> 'OPEN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable: a paid or cancelled account is final';
    END IF;
END;
CREATE TRIGGER `sales_receivable_installment_no_update` BEFORE UPDATE ON `sales_receivable_installment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_installment is immutable';
CREATE TRIGGER `sales_receivable_installment_no_delete` BEFORE DELETE ON `sales_receivable_installment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_installment is immutable';

-- Nace abierta, de una venta de ese cliente.
CREATE TRIGGER `sales_receivable_insert_rules` BEFORE INSERT ON `sales_receivable` FOR EACH ROW
BEGIN
    IF NEW.`status` <> 'OPEN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable: an account is created open';
    END IF;
    IF NOT (NEW.`customerId` <=> (SELECT `customerId` FROM `sale` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`saleId`)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable: the customer is not the one of the sale';
    END IF;
END;

-- Lo pactado del pedido, plan incluido, no cambia.
DROP TRIGGER `sales_order_update_rules`;
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
        OR NOT (NEW.`installmentMonths` <=> OLD.`installmentMonths`)
        OR NOT (NEW.`installmentInterestPercent` <=> OLD.`installmentInterestPercent`)
        OR NOT (NEW.`downPayment` <=> OLD.`downPayment`)
        OR NEW.`createdByUserId` <> OLD.`createdByUserId`
        OR NEW.`createdAt` <> OLD.`createdAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: what was agreed cannot change';
    END IF;
    IF NEW.`status` <> OLD.`status` AND NOT (
        OLD.`status` IN ('OPEN', 'PARTIAL') AND NEW.`status` IN ('PARTIAL', 'FULFILLED', 'CANCELLED')
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: that status change is not allowed';
    END IF;
    IF OLD.`status` = 'CANCELLED' AND (
        NOT (NEW.`cancelledByUserId` <=> OLD.`cancelledByUserId`)
        OR NOT (NEW.`cancelledAt` <=> OLD.`cancelledAt`)
        OR NOT (NEW.`cancelReason` <=> OLD.`cancelReason`)
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: a cancellation cannot change';
    END IF;
END;
