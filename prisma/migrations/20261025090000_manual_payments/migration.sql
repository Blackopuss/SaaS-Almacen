-- CreateTable
CREATE TABLE `manual_payment` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `kind` ENUM('PAYMENT', 'REVERSAL') NOT NULL DEFAULT 'PAYMENT',
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MXN',
    `paidOn` DATE NOT NULL,
    `reference` VARCHAR(40) NULL,
    `months` INTEGER NOT NULL,
    `notes` VARCHAR(500) NULL,
    `reversesPaymentId` CHAR(36) NULL,
    `validUntilBefore` DATETIME(3) NOT NULL,
    `validUntilAfter` DATETIME(3) NOT NULL,
    `recordedByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `manual_payment_organizationId_reference_idx`(`organizationId`, `reference`),
    INDEX `manual_payment_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    UNIQUE INDEX `manual_payment_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `manual_payment_organizationId_reversesPaymentId_key`(`organizationId`, `reversesPaymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `manual_payment` ADD CONSTRAINT `manual_payment_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `manual_payment` ADD CONSTRAINT `manual_payment_organizationId_reversesPaymentId_fkey` FOREIGN KEY (`organizationId`, `reversesPaymentId`) REFERENCES `manual_payment`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;


-- PIL-11 (ADR 0027): pagos SPEI registrados por el personal de plataforma.
-- Un pago alarga la vigencia; una anulación apunta a su pago y la acorta
-- (o la deja igual si el plan ya había vencido).
ALTER TABLE `manual_payment`
  ADD CONSTRAINT `manual_payment_amount_positive` CHECK (`amount` > 0),
  ADD CONSTRAINT `manual_payment_months_range` CHECK (`months` BETWEEN 1 AND 12),
  ADD CONSTRAINT `manual_payment_currency_mxn` CHECK (`currency` = 'MXN'),
  ADD CONSTRAINT `manual_payment_kind_shape` CHECK (
    (`kind` = 'PAYMENT' AND `reference` IS NOT NULL AND `reversesPaymentId` IS NULL
      AND `validUntilAfter` > `validUntilBefore`)
    OR (`kind` = 'REVERSAL' AND `reference` IS NULL AND `reversesPaymentId` IS NOT NULL
      AND `notes` IS NOT NULL AND `validUntilAfter` <= `validUntilBefore`)
  );

-- Inmutables: un error se corrige con una anulación.
CREATE TRIGGER `manual_payment_no_update` BEFORE UPDATE ON `manual_payment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'manual_payment is immutable';
CREATE TRIGGER `manual_payment_no_delete` BEFORE DELETE ON `manual_payment` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'manual_payment is immutable';
