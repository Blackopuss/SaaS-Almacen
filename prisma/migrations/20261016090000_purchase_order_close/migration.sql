-- CMP-11: cerrar una orden recibida en parte con su faltante.
ALTER TABLE `purchase_order` ADD COLUMN `closeReason` VARCHAR(300) NULL,
    ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `closedByUserId` CHAR(36) NULL,
    MODIFY `status` ENUM('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED', 'CLOSED') NOT NULL DEFAULT 'DRAFT';

-- Cada estado con sus datos; una cerrada dice cuándo, quién y por qué, y
-- ninguna otra tiene datos de cierre.
ALTER TABLE `purchase_order` DROP CHECK `purchase_order_state_check`;
ALTER TABLE `purchase_order` ADD CONSTRAINT `purchase_order_state_check` CHECK (
    (`status` = 'DRAFT' AND `sentAt` IS NULL AND `cancelledAt` IS NULL AND `closedAt` IS NULL)
    OR (`status` IN ('SENT', 'PARTIAL', 'RECEIVED') AND `sentAt` IS NOT NULL AND `sentByUserId` IS NOT NULL AND `cancelledAt` IS NULL AND `closedAt` IS NULL)
    OR (`status` = 'CANCELLED' AND `cancelledAt` IS NOT NULL AND `cancelledByUserId` IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(`cancelReason`, ''))) > 0 AND `closedAt` IS NULL)
    OR (`status` = 'CLOSED' AND `sentAt` IS NOT NULL AND `cancelledAt` IS NULL AND `closedAt` IS NOT NULL AND `closedByUserId` IS NOT NULL AND CHAR_LENGTH(TRIM(COALESCE(`closeReason`, ''))) > 0)
);

-- Las transiciones (CMP-05) con la nueva: lo recibido en parte se cierra
-- con faltante; nada sale de «cerrada».
DROP TRIGGER `purchase_order_transition`;
CREATE TRIGGER `purchase_order_transition` BEFORE UPDATE ON `purchase_order` FOR EACH ROW
BEGIN
    IF NEW.`status` <> OLD.`status` AND NOT (
        (OLD.`status` = 'DRAFT' AND NEW.`status` IN ('SENT', 'CANCELLED'))
        OR (OLD.`status` = 'SENT' AND NEW.`status` IN ('PARTIAL', 'RECEIVED', 'CANCELLED'))
        OR (OLD.`status` = 'PARTIAL' AND NEW.`status` IN ('RECEIVED', 'CLOSED'))
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order: invalid state transition';
    END IF;
    -- La orden no cambia de proveedor ni de número.
    IF NEW.`contactId` <> OLD.`contactId` OR NEW.`number` <> OLD.`number` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order: supplier and number cannot change';
    END IF;
END;
