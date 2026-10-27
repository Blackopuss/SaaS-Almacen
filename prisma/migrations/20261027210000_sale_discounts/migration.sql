-- AlterTable
ALTER TABLE `sale` ADD COLUMN `discountAuthorizationId` CHAR(36) NULL,
    ADD COLUMN `discountPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `discountReason` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `sales_settings` ADD COLUMN `discountCapAdministrator` DECIMAL(5, 2) NOT NULL DEFAULT 100,
    ADD COLUMN `discountCapCashManager` DECIMAL(5, 2) NOT NULL DEFAULT 20,
    ADD COLUMN `discountCapCashier` DECIMAL(5, 2) NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE `sale_discount_authorization` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `sellerUserId` CHAR(36) NOT NULL,
    `authorizerUserId` CHAR(36) NOT NULL,
    `percent` DECIMAL(5, 2) NOT NULL,
    `belowCost` BOOLEAN NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sale_discount_authorization_organizationId_sellerUserId_crea_idx`(`organizationId`, `sellerUserId`, `createdAt`),
    UNIQUE INDEX `sale_discount_authorization_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `sale_organizationId_discountAuthorizationId_key` ON `sale`(`organizationId`, `discountAuthorizationId`);

-- AddForeignKey
ALTER TABLE `sale` ADD CONSTRAINT `sale_organizationId_discountAuthorizationId_fkey` FOREIGN KEY (`organizationId`, `discountAuthorizationId`) REFERENCES `sale_discount_authorization`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_discount_authorization` ADD CONSTRAINT `sale_discount_authorization_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- VEN-14 (ADR 0030): descuentos con tope por rol y autorización. Solo expansión.

ALTER TABLE `sales_settings` ADD CONSTRAINT `sales_settings_discount_caps` CHECK (
    `discountCapCashier` >= 0 AND `discountCapCashier` <= 100
    AND `discountCapCashManager` >= 0 AND `discountCapCashManager` <= 100
    AND `discountCapAdministrator` >= 0 AND `discountCapAdministrator` <= 100
);

-- Un descuento lleva su motivo; sin descuento, sin motivo. (MySQL no deja
-- usar en un CHECK la columna de la autorización: es parte de una llave
-- foránea; que no haya autorización sin descuento lo cuida el servicio.)
ALTER TABLE `sale` ADD CONSTRAINT `sale_discount_check` CHECK (
    `discountPercent` >= 0 AND `discountPercent` <= 100
    AND (
        (`discountPercent` = 0 AND `discountReason` IS NULL)
        OR (`discountPercent` > 0 AND `discountReason` IS NOT NULL)
    )
);

ALTER TABLE `sale_discount_authorization` ADD CONSTRAINT `sale_discount_authorization_check` CHECK (
    `percent` > 0 AND `percent` <= 100
);

-- Una autorización es un registro: no se edita ni se borra; se usa una vez
-- (índice único en `sale`).
CREATE TRIGGER `sale_discount_authorization_no_update` BEFORE UPDATE ON `sale_discount_authorization` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_discount_authorization is immutable';
CREATE TRIGGER `sale_discount_authorization_no_delete` BEFORE DELETE ON `sale_discount_authorization` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_discount_authorization is immutable';

-- De una venta solo cambia su cancelación: también el descuento queda fijo.
DROP TRIGGER `sale_only_cancel`;
CREATE TRIGGER `sale_only_cancel` BEFORE UPDATE ON `sale` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'COMPLETED' OR NEW.`status` <> 'CANCELLED'
        OR NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`number` <> OLD.`number`
        OR NOT (NEW.`customerId` <=> OLD.`customerId`)
        OR NEW.`movementId` <> OLD.`movementId`
        OR NEW.`pricesIncludeTax` <> OLD.`pricesIncludeTax`
        OR NEW.`taxRate` <> OLD.`taxRate`
        OR NEW.`discount` <> OLD.`discount`
        OR NEW.`discountPercent` <> OLD.`discountPercent`
        OR NOT (NEW.`discountReason` <=> OLD.`discountReason`)
        OR NOT (NEW.`discountAuthorizationId` <=> OLD.`discountAuthorizationId`)
        OR NEW.`subtotal` <> OLD.`subtotal`
        OR NEW.`tax` <> OLD.`tax`
        OR NEW.`total` <> OLD.`total`
        OR NEW.`idempotencyKey` <> OLD.`idempotencyKey`
        OR NEW.`soldByUserId` <> OLD.`soldByUserId`
        OR NEW.`createdAt` <> OLD.`createdAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: only a completed sale can be cancelled, once';
    END IF;
END;
