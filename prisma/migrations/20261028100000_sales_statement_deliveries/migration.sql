-- CreateTable
CREATE TABLE `sales_statement_delivery` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `recipient` VARCHAR(254) NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `jobId` CHAR(36) NOT NULL,
    `requestedByUserId` CHAR(36) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(300) NULL,

    INDEX `sales_statement_delivery_organizationId_customerId_requested_idx`(`organizationId`, `customerId`, `requestedAt`),
    INDEX `sales_statement_delivery_organizationId_requestedAt_idx`(`organizationId`, `requestedAt`),
    UNIQUE INDEX `sales_statement_delivery_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_statement_delivery_organizationId_jobId_key`(`organizationId`, `jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_statement_delivery` ADD CONSTRAINT `sales_statement_delivery_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_statement_delivery` ADD CONSTRAINT `sales_statement_delivery_organizationId_customerId_fkey` FOREIGN KEY (`organizationId`, `customerId`) REFERENCES `contact`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- PAG-06 (ADR 0030): envío del estado de cuenta por correo, como el de la
-- cotización (COT-03). Solo expansión.
ALTER TABLE `sales_statement_delivery` ADD CONSTRAINT `sales_statement_delivery_state_check` CHECK (
    (`status` = 'QUEUED' AND `sentAt` IS NULL AND `failedAt` IS NULL AND `failureReason` IS NULL)
    OR (`status` = 'SENT' AND `sentAt` IS NOT NULL AND `failedAt` IS NULL AND `failureReason` IS NULL)
    OR (`status` = 'FAILED' AND `failedAt` IS NOT NULL AND `sentAt` IS NULL AND `failureReason` IS NOT NULL AND CHAR_LENGTH(TRIM(`failureReason`)) > 0)
);
ALTER TABLE `sales_statement_delivery` ADD CONSTRAINT `sales_statement_delivery_recipient_check` CHECK (
    REGEXP_LIKE(`recipient`, '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+[.][^[:space:][:cntrl:]@]+$')
);

CREATE TRIGGER `sales_statement_delivery_final` BEFORE UPDATE ON `sales_statement_delivery` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'QUEUED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_statement_delivery: a finished delivery cannot change';
    END IF;
    IF NEW.`customerId` <> OLD.`customerId` OR NEW.`recipient` <> OLD.`recipient` OR NEW.`jobId` <> OLD.`jobId`
        OR NEW.`requestedByUserId` <> OLD.`requestedByUserId` OR NEW.`requestedAt` <> OLD.`requestedAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_statement_delivery: its data cannot change';
    END IF;
END;
CREATE TRIGGER `sales_statement_delivery_no_delete` BEFORE DELETE ON `sales_statement_delivery` FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_statement_delivery: deliveries are history and cannot be deleted';
