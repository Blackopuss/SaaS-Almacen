-- AlterTable
ALTER TABLE `sale` ADD COLUMN `cashSessionId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `cash_session` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `openedByUserId` CHAR(36) NOT NULL,
    `openingFloat` DECIMAL(14, 2) NOT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isOpen` BOOLEAN NULL DEFAULT true,
    `closedAt` DATETIME(3) NULL,
    `closedByUserId` CHAR(36) NULL,
    `expectedCash` DECIMAL(14, 2) NULL,
    `expectedCard` DECIMAL(14, 2) NULL,
    `expectedTransfer` DECIMAL(14, 2) NULL,
    `countedCash` DECIMAL(14, 2) NULL,
    `countedCard` DECIMAL(14, 2) NULL,
    `countedTransfer` DECIMAL(14, 2) NULL,
    `closeNote` VARCHAR(500) NULL,

    INDEX `cash_session_organizationId_openedAt_idx`(`organizationId`, `openedAt`),
    UNIQUE INDEX `cash_session_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `cash_session_organizationId_openedByUserId_isOpen_key`(`organizationId`, `openedByUserId`, `isOpen`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_movement` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `sessionId` CHAR(36) NOT NULL,
    `direction` ENUM('IN', 'OUT') NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `cash_movement_organizationId_sessionId_createdAt_idx`(`organizationId`, `sessionId`, `createdAt`),
    UNIQUE INDEX `cash_movement_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `sale_organizationId_cashSessionId_idx` ON `sale`(`organizationId`, `cashSessionId`);

-- AddForeignKey
ALTER TABLE `sale` ADD CONSTRAINT `sale_organizationId_cashSessionId_fkey` FOREIGN KEY (`organizationId`, `cashSessionId`) REFERENCES `cash_session`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_session` ADD CONSTRAINT `cash_session_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_movement` ADD CONSTRAINT `cash_movement_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_movement` ADD CONSTRAINT `cash_movement_organizationId_sessionId_fkey` FOREIGN KEY (`organizationId`, `sessionId`) REFERENCES `cash_session`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- VEN-16..18 (ADR 0030): la caja. Solo expansión.

-- Abierta: sin datos de cierre. Cerrada: con quién, cuándo, lo esperado y
-- lo contado. `isOpen` es 1 o NULL (nunca 0): una abierta por persona.
ALTER TABLE `cash_session` ADD CONSTRAINT `cash_session_state_check` CHECK (
    `openingFloat` >= 0
    AND (`isOpen` IS NULL OR `isOpen` = 1)
    AND (
        (`isOpen` = 1 AND `closedAt` IS NULL AND `closedByUserId` IS NULL
            AND `expectedCash` IS NULL AND `countedCash` IS NULL
            AND `expectedCard` IS NULL AND `countedCard` IS NULL
            AND `expectedTransfer` IS NULL AND `countedTransfer` IS NULL)
        OR (`isOpen` IS NULL AND `closedAt` IS NOT NULL AND `closedByUserId` IS NOT NULL
            AND `expectedCash` IS NOT NULL AND `countedCash` IS NOT NULL
            AND `expectedCard` IS NOT NULL AND `countedCard` IS NOT NULL
            AND `expectedTransfer` IS NOT NULL AND `countedTransfer` IS NOT NULL
            AND `countedCash` >= 0 AND `countedCard` >= 0 AND `countedTransfer` >= 0)
    )
);

ALTER TABLE `cash_movement` ADD CONSTRAINT `cash_movement_amount_check` CHECK (`amount` > 0);

-- Una caja se cierra una vez y no se borra; de ella solo cambia su cierre.
CREATE TRIGGER `cash_session_no_delete` BEFORE DELETE ON `cash_session` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cash_session is history';
CREATE TRIGGER `cash_session_close_once` BEFORE UPDATE ON `cash_session` FOR EACH ROW
BEGIN
    IF OLD.`isOpen` IS NULL OR NEW.`isOpen` IS NOT NULL
        OR NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`openedByUserId` <> OLD.`openedByUserId`
        OR NEW.`openingFloat` <> OLD.`openingFloat`
        OR NEW.`openedAt` <> OLD.`openedAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cash_session: only an open register can be closed, once';
    END IF;
END;

-- Ingresos y egresos: solo en una caja abierta; no se editan ni se borran.
CREATE TRIGGER `cash_movement_open_session` BEFORE INSERT ON `cash_movement` FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM `cash_session`
        WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`sessionId` AND `isOpen` = 1
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cash_movement: the register is not open';
    END IF;
END;
CREATE TRIGGER `cash_movement_no_update` BEFORE UPDATE ON `cash_movement` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cash_movement is immutable';
CREATE TRIGGER `cash_movement_no_delete` BEFORE DELETE ON `cash_movement` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cash_movement is immutable';

-- Una venta nueva entra en la caja abierta de quien la cobra.
CREATE TRIGGER `sale_cash_session_open` BEFORE INSERT ON `sale` FOR EACH ROW
BEGIN
    IF NEW.`cashSessionId` IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM `cash_session`
        WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`cashSessionId`
            AND `isOpen` = 1 AND `openedByUserId` = NEW.`soldByUserId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: the register is not open, or not of who charges';
    END IF;
END;

-- La caja de una venta tampoco cambia después.
DROP TRIGGER `sale_only_cancel`;
CREATE TRIGGER `sale_only_cancel` BEFORE UPDATE ON `sale` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'COMPLETED' OR NEW.`status` <> 'CANCELLED'
        OR NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`number` <> OLD.`number`
        OR NOT (NEW.`customerId` <=> OLD.`customerId`)
        OR NEW.`movementId` <> OLD.`movementId`
        OR NOT (NEW.`cashSessionId` <=> OLD.`cashSessionId`)
        OR NEW.`pricesIncludeTax` <> OLD.`pricesIncludeTax`
        OR NEW.`taxRate` <> OLD.`taxRate`
        OR NEW.`discount` <> OLD.`discount`
        OR NEW.`discountPercent` <> OLD.`discountPercent`
        OR NOT (NEW.`discountReason` <=> OLD.`discountReason`)
        OR NOT (NEW.`discountAuthorizationId` <=> OLD.`discountAuthorizationId`)
        OR NEW.`subtotal` <> OLD.`subtotal`
        OR NEW.`tax` <> OLD.`tax`
        OR NEW.`total` <> OLD.`total`
        OR NEW.`idempotencyKey` <> OLD.`idempotencyKey`
        OR NEW.`soldByUserId` <> OLD.`soldByUserId`
        OR NEW.`createdAt` <> OLD.`createdAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: only a completed sale can be cancelled, once';
    END IF;
END;
