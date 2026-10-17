-- AlterTable
ALTER TABLE `purchase_receipt_line` ADD COLUMN `unitCost` DECIMAL(14, 4) NULL;


-- Un costo nunca es negativo (CMP-13).
ALTER TABLE `purchase_receipt_line` ADD CONSTRAINT `purchase_receipt_line_cost_check` CHECK (
    `unitCost` IS NULL OR `unitCost` >= 0
);
