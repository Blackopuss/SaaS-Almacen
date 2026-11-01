-- CreateTable
CREATE TABLE `sales_quote_delivery` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `quoteId` CHAR(36) NOT NULL,
    `recipient` VARCHAR(254) NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `jobId` CHAR(36) NOT NULL,
    `requestedByUserId` CHAR(36) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(300) NULL,

    INDEX `sales_quote_delivery_organizationId_quoteId_requestedAt_idx`(`organizationId`, `quoteId`, `requestedAt`),
    INDEX `sales_quote_delivery_organizationId_requestedAt_idx`(`organizationId`, `requestedAt`),
    UNIQUE INDEX `sales_quote_delivery_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_quote_delivery_organizationId_jobId_key`(`organizationId`, `jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_quote_delivery` ADD CONSTRAINT `sales_quote_delivery_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_quote_delivery` ADD CONSTRAINT `sales_quote_delivery_organizationId_quoteId_fkey` FOREIGN KEY (`organizationId`, `quoteId`) REFERENCES `sales_quote`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cada estado con sus datos: en espera no tiene fechas; enviado dice
-- cuándo; fallido dice cuándo y por qué (COT-03).
ALTER TABLE `sales_quote_delivery` ADD CONSTRAINT `sales_quote_delivery_state_check` CHECK (
    (`status` = 'QUEUED' AND `sentAt` IS NULL AND `failedAt` IS NULL AND `failureReason` IS NULL)
    OR (`status` = 'SENT' AND `sentAt` IS NOT NULL AND `failedAt` IS NULL AND `failureReason` IS NULL)
    OR (`status` = 'FAILED' AND `failedAt` IS NOT NULL AND `sentAt` IS NULL AND `failureReason` IS NOT NULL AND CHAR_LENGTH(TRIM(`failureReason`)) > 0)
);

-- El destinatario es un correo, sin espacios ni saltos de línea.
ALTER TABLE `sales_quote_delivery` ADD CONSTRAINT `sales_quote_delivery_recipient_check` CHECK (
    REGEXP_LIKE(`recipient`, '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+[.][^[:space:][:cntrl:]@]+$')
);

-- Solo se manda una cotización enviada (pedir el correo de un borrador la
-- marca enviada en la misma transacción, antes de este renglón).
CREATE TRIGGER `sales_quote_delivery_quote_state` BEFORE INSERT ON `sales_quote_delivery` FOR EACH ROW
BEGIN
    IF COALESCE((SELECT `status` FROM `sales_quote` WHERE `id` = NEW.`quoteId` AND `organizationId` = NEW.`organizationId`), 'NONE') <> 'SENT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_delivery: the quote is not sent';
    END IF;
END;

-- Un envío terminado ya no cambia, y nunca cambia a quién, de qué
-- cotización ni quién lo pidió.
CREATE TRIGGER `sales_quote_delivery_final` BEFORE UPDATE ON `sales_quote_delivery` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'QUEUED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_delivery: a finished delivery cannot change';
    END IF;
    IF NEW.`quoteId` <> OLD.`quoteId` OR NEW.`recipient` <> OLD.`recipient` OR NEW.`jobId` <> OLD.`jobId`
        OR NEW.`requestedByUserId` <> OLD.`requestedByUserId` OR NEW.`requestedAt` <> OLD.`requestedAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_delivery: its data cannot change';
    END IF;
END;

CREATE TRIGGER `sales_quote_delivery_no_delete` BEFORE DELETE ON `sales_quote_delivery` FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_quote_delivery: deliveries are history and cannot be deleted';
END;
