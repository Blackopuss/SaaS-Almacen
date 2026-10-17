-- AlterTable
ALTER TABLE `product_import` ADD COLUMN `confirmedAt` DATETIME(3) NULL,
    ADD COLUMN `confirmedByUserId` CHAR(36) NULL,
    ADD COLUMN `reservedPlaces` INTEGER NOT NULL DEFAULT 0,
    MODIFY `status` ENUM('MAPPING', 'READY', 'CONFIRMED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'MAPPING';


-- Held places are never negative, and only a confirmed import holds any.
ALTER TABLE `product_import` ADD CONSTRAINT `product_import_reserved_check` CHECK (`reservedPlaces` >= 0 AND (`reservedPlaces` = 0 OR `status` IN ('CONFIRMED', 'RUNNING')));
-- From confirmation on, it says when it was confirmed.
ALTER TABLE `product_import` ADD CONSTRAINT `product_import_confirmed_check` CHECK ((`status` IN ('MAPPING', 'READY')) = (`confirmedAt` IS NULL) OR `status` = 'CANCELLED');
