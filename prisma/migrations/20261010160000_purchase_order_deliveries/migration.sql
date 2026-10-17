-- CreateTable
CREATE TABLE `purchase_order_delivery` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `orderId` CHAR(36) NOT NULL,
    `recipient` VARCHAR(254) NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `jobId` CHAR(36) NOT NULL,
    `requestedByUserId` CHAR(36) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(300) NULL,

    INDEX `purchase_order_delivery_organizationId_orderId_requestedAt_idx`(`organizationId`, `orderId`, `requestedAt`),
    INDEX `purchase_order_delivery_organizationId_requestedAt_idx`(`organizationId`, `requestedAt`),
    UNIQUE INDEX `purchase_order_delivery_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `purchase_order_delivery_organizationId_jobId_key`(`organizationId`, `jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `purchase_order_delivery` ADD CONSTRAINT `purchase_order_delivery_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_delivery` ADD CONSTRAINT `purchase_order_delivery_organizationId_orderId_fkey` FOREIGN KEY (`organizationId`, `orderId`) REFERENCES `purchase_order`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cada estado con sus datos: en espera no tiene fechas; enviado dice
-- cuándo; fallido dice cuándo y por qué.
ALTER TABLE `purchase_order_delivery` ADD CONSTRAINT `purchase_order_delivery_state_check` CHECK (
    (`status` = 'QUEUED' AND `sentAt` IS NULL AND `failedAt` IS NULL AND `failureReason` IS NULL)
    OR (`status` = 'SENT' AND `sentAt` IS NOT NULL AND `failedAt` IS NULL AND `failureReason` IS NULL)
    OR (`status` = 'FAILED' AND `failedAt` IS NOT NULL AND `sentAt` IS NULL AND `failureReason` IS NOT NULL AND CHAR_LENGTH(TRIM(`failureReason`)) > 0)
);

-- El destinatario es un correo, sin espacios ni saltos de línea.
ALTER TABLE `purchase_order_delivery` ADD CONSTRAINT `purchase_order_delivery_recipient_check` CHECK (
    REGEXP_LIKE(`recipient`, '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+[.][^[:space:][:cntrl:]@]+$')
);

-- Solo se envía una orden que ya es un pedido: enviada o recibida en parte.
CREATE TRIGGER `purchase_order_delivery_order_state` BEFORE INSERT ON `purchase_order_delivery` FOR EACH ROW
BEGIN
    IF COALESCE((SELECT `status` FROM `purchase_order` WHERE `id` = NEW.`orderId` AND `organizationId` = NEW.`organizationId`), 'NONE') NOT IN ('SENT', 'PARTIAL') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order_delivery: the order is not sent';
    END IF;
END;

-- Un envío terminado ya no cambia, y nunca cambia a quién, de qué orden
-- ni quién lo pidió.
CREATE TRIGGER `purchase_order_delivery_final` BEFORE UPDATE ON `purchase_order_delivery` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'QUEUED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order_delivery: a finished delivery cannot change';
    END IF;
    IF NEW.`orderId` <> OLD.`orderId` OR NEW.`recipient` <> OLD.`recipient` OR NEW.`jobId` <> OLD.`jobId`
        OR NEW.`requestedByUserId` <> OLD.`requestedByUserId` OR NEW.`requestedAt` <> OLD.`requestedAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order_delivery: its data cannot change';
    END IF;
END;

CREATE TRIGGER `purchase_order_delivery_no_delete` BEFORE DELETE ON `purchase_order_delivery` FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order_delivery: deliveries are history and cannot be deleted';
END;
