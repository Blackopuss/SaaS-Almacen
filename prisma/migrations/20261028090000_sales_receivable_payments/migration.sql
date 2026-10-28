-- CreateTable
CREATE TABLE `sales_receivable_payment` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL,
    `receivableId` CHAR(36) NOT NULL,
    `cashSessionId` CHAR(36) NOT NULL,
    `method` ENUM('CASH', 'CARD', 'TRANSFER') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `received` DECIMAL(14, 2) NULL,
    `changeGiven` DECIMAL(14, 2) NULL,
    `reference` VARCHAR(60) NULL,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `receivedByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sales_receivable_payment_organizationId_receivableId_created_idx`(`organizationId`, `receivableId`, `createdAt`),
    INDEX `sales_receivable_payment_organizationId_cashSessionId_idx`(`organizationId`, `cashSessionId`),
    UNIQUE INDEX `sales_receivable_payment_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_receivable_payment_organizationId_number_key`(`organizationId`, `number`),
    UNIQUE INDEX `sales_receivable_payment_organizationId_idempotencyKey_key`(`organizationId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_receivable_payment` ADD CONSTRAINT `sales_receivable_payment_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable_payment` ADD CONSTRAINT `sales_receivable_payment_organizationId_receivableId_fkey` FOREIGN KEY (`organizationId`, `receivableId`) REFERENCES `sales_receivable`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable_payment` ADD CONSTRAINT `sales_receivable_payment_organizationId_cashSessionId_fkey` FOREIGN KEY (`organizationId`, `cashSessionId`) REFERENCES `cash_session`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- PAG-05 (ADR 0030): abonos a una cuenta, en caja. Solo expansión.
ALTER TABLE `sales_receivable_payment` ADD CONSTRAINT `sales_receivable_payment_check` CHECK (
    `number` >= 1 AND `amount` > 0
    AND (
        (`method` = 'CASH' AND `received` IS NOT NULL AND `changeGiven` IS NOT NULL
            AND `received` >= `amount` AND `changeGiven` = `received` - `amount`
            AND `reference` IS NULL)
        OR (`method` <> 'CASH' AND `received` IS NULL AND `changeGiven` IS NULL)
    )
);

-- Un abono es un registro: no se edita ni se borra.
CREATE TRIGGER `sales_receivable_payment_no_update` BEFORE UPDATE ON `sales_receivable_payment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_payment is immutable';
CREATE TRIGGER `sales_receivable_payment_no_delete` BEFORE DELETE ON `sales_receivable_payment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_payment is immutable';

-- Entra en la caja abierta de quien lo recibe, a una cuenta abierta.
CREATE TRIGGER `sales_receivable_payment_insert_rules` BEFORE INSERT ON `sales_receivable_payment` FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `cash_session`
        WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`cashSessionId`
            AND `isOpen` = 1 AND `openedByUserId` = NEW.`receivedByUserId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_payment: the register is not open, or not of who receives';
    END IF;
    IF COALESCE((SELECT `status` FROM `sales_receivable` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`receivableId`), 'NONE') <> 'OPEN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_payment: the account is not open';
    END IF;
END;
