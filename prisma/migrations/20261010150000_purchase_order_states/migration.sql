-- AlterTable
ALTER TABLE `purchase_order` ADD COLUMN `sentAt` DATETIME(3) NULL,
    ADD COLUMN `sentByUserId` CHAR(36) NULL,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelledByUserId` CHAR(36) NULL,
    ADD COLUMN `cancelReason` VARCHAR(300) NULL;

-- Cada estado con sus datos: un borrador no tiene fecha de envío; una orden
-- enviada o recibida sí, y no está cancelada; una cancelada dice cuándo,
-- quién y por qué.
ALTER TABLE `purchase_order` ADD CONSTRAINT `purchase_order_state_check` CHECK (
    (`status` = 'DRAFT' AND `sentAt` IS NULL AND `cancelledAt` IS NULL)
    OR (`status` IN ('SENT', 'PARTIAL', 'RECEIVED') AND `sentAt` IS NOT NULL AND `sentByUserId` IS NOT NULL AND `cancelledAt` IS NULL)
    OR (`status` = 'CANCELLED' AND `cancelledAt` IS NOT NULL AND `cancelledByUserId` IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(`cancelReason`, ''))) > 0)
);

-- Las transiciones válidas (CMP-05), también en la base: nada sale de
-- «recibida» o «cancelada», nada vuelve atrás, un borrador no se recibe
-- sin enviarse y lo recibido en parte no se cancela.
CREATE TRIGGER `purchase_order_transition` BEFORE UPDATE ON `purchase_order` FOR EACH ROW
BEGIN
    IF NEW.`status` <> OLD.`status` AND NOT (
        (OLD.`status` = 'DRAFT' AND NEW.`status` IN ('SENT', 'CANCELLED'))
        OR (OLD.`status` = 'SENT' AND NEW.`status` IN ('PARTIAL', 'RECEIVED', 'CANCELLED'))
        OR (OLD.`status` = 'PARTIAL' AND NEW.`status` = 'RECEIVED')
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order: invalid state transition';
    END IF;
    -- La orden no cambia de proveedor ni de número.
    IF NEW.`contactId` <> OLD.`contactId` OR NEW.`number` <> OLD.`number` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order: supplier and number cannot change';
    END IF;
END;

-- Las líneas solo cambian mientras su orden es un borrador.
CREATE TRIGGER `purchase_order_line_draft_insert` BEFORE INSERT ON `purchase_order_line` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `purchase_order` WHERE `id` = NEW.`orderId`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order_line: the order is not a draft';
    END IF;
END;

CREATE TRIGGER `purchase_order_line_draft_update` BEFORE UPDATE ON `purchase_order_line` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `purchase_order` WHERE `id` = OLD.`orderId`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order_line: the order is not a draft';
    END IF;
END;

CREATE TRIGGER `purchase_order_line_draft_delete` BEFORE DELETE ON `purchase_order_line` FOR EACH ROW
BEGIN
    IF (SELECT `status` FROM `purchase_order` WHERE `id` = OLD.`orderId`) <> 'DRAFT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order_line: the order is not a draft';
    END IF;
END;
