-- BIL-08..10: cambiar de plan mientras el actual está vigente. El plan
-- nuevo empieza al pagar y se conservan los días que quedan; si cuesta
-- más, se cobra la diferencia por esos días (`prorated`). Con 0 meses se
-- paga solo esa diferencia hasta el fin del plan actual. Solo expansión.
ALTER TABLE `checkout_order`
    ADD COLUMN `prorated` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `proratedDays` INTEGER NULL;

ALTER TABLE `checkout_order` DROP CHECK `checkout_order_months`;
ALTER TABLE `checkout_order`
    ADD CONSTRAINT `checkout_order_months` CHECK (`months` IN (0, 1, 3, 6, 12)),
    ADD CONSTRAINT `checkout_order_prorated` CHECK (
        `prorated` >= 0 AND `prorated` <= `subtotal`
        AND (`proratedDays` IS NULL OR `proratedDays` >= 0)
        AND (`prorated` = 0 OR `proratedDays` IS NOT NULL)
        AND (`months` > 0 OR `prorated` > 0)
    );

DROP TRIGGER `checkout_order_frozen`;
CREATE TRIGGER `checkout_order_frozen` BEFORE UPDATE ON `checkout_order` FOR EACH ROW
BEGIN
  IF NEW.`organizationId` <> OLD.`organizationId` OR NEW.`transactionId` <> OLD.`transactionId`
    OR NEW.`userId` <> OLD.`userId` OR NEW.`tier` <> OLD.`tier` OR NEW.`modules` <> OLD.`modules`
    OR NEW.`months` <> OLD.`months` OR NEW.`subtotal` <> OLD.`subtotal`
    OR NEW.`prorated` <> OLD.`prorated` OR NOT (NEW.`proratedDays` <=> OLD.`proratedDays`)
    OR NEW.`discount` <> OLD.`discount` OR NEW.`tax` <> OLD.`tax` OR NEW.`total` <> OLD.`total`
    OR NEW.`provider` <> OLD.`provider` OR NOT (NEW.`promoCodeId` <=> OLD.`promoCodeId`) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'checkout_order amounts are immutable';
  END IF;
  IF OLD.`status` <> 'PENDING' AND NEW.`status` <> OLD.`status` THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'checkout_order status is final';
  END IF;
  IF OLD.`status` = 'PAID' AND (NOT (NEW.`validUntilAfter` <=> OLD.`validUntilAfter`)
    OR NOT (NEW.`paidAt` <=> OLD.`paidAt`) OR NOT (NEW.`paymentRef` <=> OLD.`paymentRef`)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a paid checkout_order is immutable';
  END IF;
END;
