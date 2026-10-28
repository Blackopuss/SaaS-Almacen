-- AlterTable
ALTER TABLE `sales_settings` ADD COLUMN `overdueReminders` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `sales_receivable_reminder` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `receivableId` CHAR(36) NOT NULL,
    `installmentNumber` INTEGER NOT NULL,
    `recipient` VARCHAR(254) NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `jobId` CHAR(36) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(300) NULL,

    INDEX `sales_receivable_reminder_organizationId_requestedAt_idx`(`organizationId`, `requestedAt`),
    UNIQUE INDEX `sales_receivable_reminder_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_receivable_reminder_organizationId_jobId_key`(`organizationId`, `jobId`),
    UNIQUE INDEX `sales_receivable_reminder_organizationId_receivableId_instal_key`(`organizationId`, `receivableId`, `installmentNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_receivable_reminder` ADD CONSTRAINT `sales_receivable_reminder_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_receivable_reminder` ADD CONSTRAINT `sales_receivable_reminder_organizationId_receivableId_fkey` FOREIGN KEY (`organizationId`, `receivableId`) REFERENCES `sales_receivable`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- PAG-07 (ADR 0030): recordatorios de pagos vencidos, uno por mensualidad
-- que vence sin pagar, enviados por el worker. Solo expansión.
ALTER TABLE `sales_receivable_reminder` ADD CONSTRAINT `sales_receivable_reminder_installment_check` CHECK (`installmentNumber` BETWEEN 1 AND 60);
ALTER TABLE `sales_receivable_reminder` ADD CONSTRAINT `sales_receivable_reminder_state_check` CHECK (
    (`status` = 'QUEUED' AND `sentAt` IS NULL AND `failedAt` IS NULL AND `failureReason` IS NULL)
    OR (`status` = 'SENT' AND `sentAt` IS NOT NULL AND `failedAt` IS NULL AND `failureReason` IS NULL)
    OR (`status` = 'FAILED' AND `failedAt` IS NOT NULL AND `sentAt` IS NULL AND `failureReason` IS NOT NULL AND CHAR_LENGTH(TRIM(`failureReason`)) > 0)
);
ALTER TABLE `sales_receivable_reminder` ADD CONSTRAINT `sales_receivable_reminder_recipient_check` CHECK (
    REGEXP_LIKE(`recipient`, '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+[.][^[:space:][:cntrl:]@]+$')
);

CREATE TRIGGER `sales_receivable_reminder_final` BEFORE UPDATE ON `sales_receivable_reminder` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'QUEUED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_reminder: a finished reminder cannot change';
    END IF;
    IF NEW.`receivableId` <> OLD.`receivableId` OR NEW.`installmentNumber` <> OLD.`installmentNumber`
        OR NEW.`recipient` <> OLD.`recipient` OR NEW.`jobId` <> OLD.`jobId` OR NEW.`requestedAt` <> OLD.`requestedAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_reminder: its data cannot change';
    END IF;
END;
CREATE TRIGGER `sales_receivable_reminder_no_delete` BEFORE DELETE ON `sales_receivable_reminder` FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_reminder: reminders are history and cannot be deleted';
