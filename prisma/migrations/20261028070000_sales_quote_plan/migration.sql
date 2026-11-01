-- AlterTable
ALTER TABLE `sales_quote` ADD COLUMN `downPayment` DECIMAL(14, 2) NULL,
    ADD COLUMN `installmentInterestPercent` DECIMAL(5, 2) NULL,
    ADD COLUMN `installmentMonths` INTEGER NULL;



-- PAG-03 (ADR 0030): una cotización puede ofrecer un plan de pagos. Los
-- tres datos van juntos (o ninguno: contado). Solo expansión.
ALTER TABLE `sales_quote` ADD CONSTRAINT `sales_quote_plan_check` CHECK (
    (`installmentMonths` IS NULL AND `installmentInterestPercent` IS NULL AND `downPayment` IS NULL)
    OR (`installmentMonths` IS NOT NULL AND `installmentInterestPercent` IS NOT NULL AND `downPayment` IS NOT NULL
        AND `installmentMonths` >= 1 AND `installmentMonths` <= 60
        AND `installmentInterestPercent` >= 0 AND `installmentInterestPercent` <= 100
        AND `downPayment` >= 0)
);

-- El plan, como lo demás que ofrece, solo cambia en borrador.
DROP TRIGGER `sales_quote_update_rules`;
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
        OR NOT (NEW.`installmentMonths` <=> OLD.`installmentMonths`)
        OR NOT (NEW.`installmentInterestPercent` <=> OLD.`installmentInterestPercent`)
        OR NOT (NEW.`downPayment` <=> OLD.`downPayment`)
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote: only a draft can be changed';
    END IF;
    IF NEW.`customerId` <> OLD.`customerId` AND NOT (
        SELECT `isCustomer` FROM `contact` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`customerId`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote: the contact is not a customer';
    END IF;
END;
