-- AlterTable
ALTER TABLE `product` ADD COLUMN `quantityStep` DECIMAL(12, 3) NOT NULL DEFAULT 1,
    ADD COLUMN `unitCode` VARCHAR(12) NOT NULL DEFAULT 'piece';

-- AddForeignKey
ALTER TABLE `product` ADD CONSTRAINT `product_unitCode_fkey` FOREIGN KEY (`unitCode`) REFERENCES `unit`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- The increment is always positive, also for SQL that skips the application.
ALTER TABLE `product`
  ADD CONSTRAINT `product_quantity_step_check` CHECK (`quantityStep` > 0);
