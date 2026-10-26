-- CreateTable
CREATE TABLE `checkout_order` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `transactionId` VARCHAR(20) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tier` VARCHAR(20) NOT NULL,
    `productLimit` INTEGER NOT NULL,
    `includedUsers` INTEGER NOT NULL,
    `modules` VARCHAR(200) NOT NULL,
    `months` INTEGER NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL,
    `discount` DECIMAL(12, 2) NOT NULL,
    `tax` DECIMAL(12, 2) NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MXN',
    `provider` ENUM('STRIPE', 'PAYPAL', 'MERCADOPAGO', 'CODE') NOT NULL,
    `providerRef` VARCHAR(255) NULL,
    `paymentRef` VARCHAR(255) NULL,
    `status` ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `promoCodeId` CHAR(36) NULL,
    `validUntilBefore` DATETIME(3) NULL,
    `validUntilAfter` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `checkout_order_transactionId_key`(`transactionId`),
    INDEX `checkout_order_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `checkout_order_status_expiresAt_idx`(`status`, `expiresAt`),
    UNIQUE INDEX `checkout_order_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `checkout_order_provider_providerRef_key`(`provider`, `providerRef`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `promo_code` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `percentOff` INTEGER NOT NULL,
    `maxRedemptions` INTEGER NOT NULL,
    `redemptions` INTEGER NOT NULL DEFAULT 0,
    `validUntil` DATETIME(3) NULL,
    `disabledAt` DATETIME(3) NULL,
    `note` VARCHAR(200) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `promo_code_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_event` (
    `id` CHAR(36) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `eventId` VARCHAR(255) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `orderId` CHAR(36) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    UNIQUE INDEX `payment_event_provider_eventId_key`(`provider`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `checkout_order` ADD CONSTRAINT `checkout_order_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkout_order` ADD CONSTRAINT `checkout_order_promoCodeId_fkey` FOREIGN KEY (`promoCodeId`) REFERENCES `promo_code`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Business rules the database keeps by itself (ADR 0028).
ALTER TABLE `checkout_order`
  ADD CONSTRAINT `checkout_order_months` CHECK (`months` IN (1, 3, 6, 12)),
  ADD CONSTRAINT `checkout_order_amounts` CHECK (
    `subtotal` >= 0 AND `discount` >= 0 AND `discount` <= `subtotal`
    AND `tax` >= 0 AND `total` = `subtotal` - `discount` + `tax`
  ),
  ADD CONSTRAINT `checkout_order_currency_mxn` CHECK (`currency` = 'MXN'),
  ADD CONSTRAINT `checkout_order_code_is_free` CHECK (
    (`provider` = 'CODE') = (`total` = 0)
  ),
  ADD CONSTRAINT `checkout_order_paid_shape` CHECK (
    `status` <> 'PAID' OR (`paidAt` IS NOT NULL AND `validUntilAfter` IS NOT NULL)
  );

ALTER TABLE `promo_code`
  ADD CONSTRAINT `promo_code_percent` CHECK (`percentOff` BETWEEN 1 AND 100),
  ADD CONSTRAINT `promo_code_redemptions` CHECK (
    `maxRedemptions` >= 1 AND `redemptions` BETWEEN 0 AND `maxRedemptions`
  );

-- What was charged never changes, a paid order never stops being paid and
-- orders are never deleted: a refund is a new record (later), not an edit.
CREATE TRIGGER `checkout_order_frozen` BEFORE UPDATE ON `checkout_order` FOR EACH ROW
BEGIN
  IF NEW.`organizationId` <> OLD.`organizationId` OR NEW.`transactionId` <> OLD.`transactionId`
    OR NEW.`userId` <> OLD.`userId` OR NEW.`tier` <> OLD.`tier` OR NEW.`modules` <> OLD.`modules`
    OR NEW.`months` <> OLD.`months` OR NEW.`subtotal` <> OLD.`subtotal`
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
CREATE TRIGGER `checkout_order_no_delete` BEFORE DELETE ON `checkout_order` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'checkout_order is append-only';
