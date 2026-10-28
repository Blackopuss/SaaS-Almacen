-- AlterTable
ALTER TABLE `sales_order` ADD COLUMN `cancelReason` VARCHAR(500) NULL,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelledByUserId` CHAR(36) NULL;



-- COT-09 (ADR 0030): cancelar un pedido cierra lo que falta por entregar,
-- una vez, con quién, cuándo y por qué. Lo entregado sigue vendido. Solo
-- expansión.
ALTER TABLE `sales_order` ADD CONSTRAINT `sales_order_cancel_check` CHECK (
    (`status` = 'CANCELLED' AND `cancelledByUserId` IS NOT NULL AND `cancelledAt` IS NOT NULL AND `cancelReason` IS NOT NULL)
    OR (`status` <> 'CANCELLED' AND `cancelledByUserId` IS NULL AND `cancelledAt` IS NULL AND `cancelReason` IS NULL)
);

-- Lo pactado no cambia; los estados siguen `SALES_ORDER_TRANSITIONS`; la
-- cancelación, una vez escrita, tampoco cambia.
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
