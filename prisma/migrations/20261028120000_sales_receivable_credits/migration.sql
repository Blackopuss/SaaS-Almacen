-- AlterTable
ALTER TABLE `sale_return` MODIFY `refundMethod` ENUM('CASH', 'CARD', 'TRANSFER') NULL;

-- CreateTable
CREATE TABLE `sales_receivable_credit` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `receivableId` CHAR(36) NOT NULL,
    `returnId` CHAR(36) NOT NULL,
    `goodsValue` DECIMAL(14, 2) NOT NULL,
    `interest` DECIMAL(14, 2) NOT NULL,
    `credited` DECIMAL(14, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_receivable_credit_organizationId_receivableId_idx`(`organizationId`, `receivableId`),
    UNIQUE INDEX `sales_receivable_credit_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_receivable_credit_organizationId_returnId_key`(`organizationId`, `returnId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_receivable_credit` ADD CONSTRAINT `sales_receivable_credit_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable_credit` ADD CONSTRAINT `sales_receivable_credit_organizationId_receivableId_fkey` FOREIGN KEY (`organizationId`, `receivableId`) REFERENCES `sales_receivable`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable_credit` ADD CONSTRAINT `sales_receivable_credit_organizationId_returnId_fkey` FOREIGN KEY (`organizationId`, `returnId`) REFERENCES `sale_return`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- PAG-08 (ADR 0030): devolver o cancelar una venta a plazos. Lo que
-- regresa (con su parte del interés) se descuenta de la cuenta; lo que
-- pasa del saldo se devuelve, así que el saldo nunca queda negativo.
-- Solo expansión: `refundMethod` admite NULL (no se devolvió dinero).
-- (Que no pase por la caja lo revisa el disparador: MySQL no deja un CHECK
-- sobre una llave foránea con acción en cascada.)
ALTER TABLE `sale_return` ADD CONSTRAINT `sale_return_no_money_check` CHECK (
    `refundMethod` IS NOT NULL OR (`refund` = 0 AND `reference` IS NULL)
);
ALTER TABLE `sales_receivable_credit` ADD CONSTRAINT `sales_receivable_credit_check` CHECK (
    `goodsValue` >= 0 AND `interest` >= 0 AND `credited` >= 0
    AND `credited` <= `goodsValue` + `interest`
);

CREATE TRIGGER `sales_receivable_credit_no_update` BEFORE UPDATE ON `sales_receivable_credit` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_credit is immutable';
CREATE TRIGGER `sales_receivable_credit_no_delete` BEFORE DELETE ON `sales_receivable_credit` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_credit is immutable';

-- Es de una devolución de la venta de esa cuenta, y lo que no se descontó
-- es lo que se devolvió.
CREATE TRIGGER `sales_receivable_credit_insert_rules` BEFORE INSERT ON `sales_receivable_credit` FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `sale_return` AS r
        JOIN `sales_receivable` AS a ON a.`organizationId` = r.`organizationId` AND a.`saleId` = r.`saleId`
        WHERE r.`organizationId` = NEW.`organizationId` AND r.`id` = NEW.`returnId` AND a.`id` = NEW.`receivableId`
            AND r.`refund` = NEW.`goodsValue` + NEW.`interest` - NEW.`credited`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_credit: not a return of the account''s sale, or it does not add up';
    END IF;
END;

-- Sin dinero de vuelta solo en una venta a plazos.
DROP TRIGGER `sale_return_insert_rules`;
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
    IF NEW.`refundMethod` IS NULL AND NEW.`cashSessionId` IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return: no money, nothing through the register';
    END IF;
    IF NEW.`refundMethod` IS NULL AND NOT EXISTS (
        SELECT 1 FROM `sales_receivable` WHERE `organizationId` = NEW.`organizationId` AND `saleId` = NEW.`saleId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_return: only a sale on installments returns without money';
    END IF;
END;

-- Una cuenta pagada se cancela si su venta se cancela.
DROP TRIGGER `sales_receivable_only_status`;
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
    IF NEW.`status` <> OLD.`status` AND NOT (
        OLD.`status` = 'OPEN' OR (OLD.`status` = 'PAID' AND NEW.`status` = 'CANCELLED')
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable: a paid or cancelled account is final';
    END IF;
END;
