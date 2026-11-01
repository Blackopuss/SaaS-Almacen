-- AlterTable
ALTER TABLE `sale` ADD COLUMN `salesOrderId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `sale_line` ADD COLUMN `orderLineId` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `sale_organizationId_salesOrderId_idx` ON `sale`(`organizationId`, `salesOrderId`);

-- CreateIndex
CREATE INDEX `sale_line_organizationId_orderLineId_idx` ON `sale_line`(`organizationId`, `orderLineId`);

-- AddForeignKey
ALTER TABLE `sale` ADD CONSTRAINT `sale_organizationId_salesOrderId_fkey` FOREIGN KEY (`organizationId`, `salesOrderId`) REFERENCES `sales_order`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_line` ADD CONSTRAINT `sale_line_organizationId_orderLineId_fkey` FOREIGN KEY (`organizationId`, `orderLineId`) REFERENCES `sales_order_line`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- COT-07 (ADR 0030): surtir un pedido es cobrarlo. Cada entrega es una
-- venta ligada al pedido y cada línea de esa venta, a la línea del pedido
-- que surte. Solo expansión.

-- Una venta de un pedido: el pedido sigue por surtir y es de su cliente.
CREATE TRIGGER `sale_sales_order_rules` BEFORE INSERT ON `sale` FOR EACH ROW
BEGIN
    IF NEW.`salesOrderId` IS NOT NULL THEN
        IF COALESCE((SELECT `status` FROM `sales_order` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`salesOrderId`), 'NONE') NOT IN ('OPEN', 'PARTIAL') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: the order is not waiting to be fulfilled';
        END IF;
        IF NOT (NEW.`customerId` <=> (SELECT `customerId` FROM `sales_order` WHERE `organizationId` = NEW.`organizationId` AND `id` = NEW.`salesOrderId`)) THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale: the customer is not the one of the order';
        END IF;
    END IF;
END;

-- Una línea que surte va en los términos de la línea del pedido: su
-- producto, su presentación con su contenido y su precio, y es del pedido
-- de la venta.
CREATE TRIGGER `sale_line_order_line` BEFORE INSERT ON `sale_line` FOR EACH ROW
BEGIN
    IF NEW.`orderLineId` IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM `sales_order_line` ol
        JOIN `sale` s ON s.`organizationId` = ol.`organizationId` AND s.`salesOrderId` = ol.`orderId`
        WHERE ol.`organizationId` = NEW.`organizationId` AND ol.`id` = NEW.`orderLineId`
            AND s.`id` = NEW.`saleId`
            AND ol.`productId` = NEW.`productId`
            AND ol.`presentationId` <=> NEW.`presentationId`
            AND ol.`factor` = NEW.`factor`
            AND ol.`unitPrice` = NEW.`unitPrice`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sale_line: not a line of the order of the sale, or other terms';
    END IF;
END;

-- El pedido de una venta tampoco cambia después.
DROP TRIGGER `sale_only_cancel`;
CREATE TRIGGER `sale_only_cancel` BEFORE UPDATE ON `sale` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'COMPLETED' OR NEW.`status` <> 'CANCELLED'
        OR NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`number` <> OLD.`number`
        OR NOT (NEW.`customerId` <=> OLD.`customerId`)
        OR NEW.`movementId` <> OLD.`movementId`
        OR NOT (NEW.`cashSessionId` <=> OLD.`cashSessionId`)
        OR NOT (NEW.`salesOrderId` <=> OLD.`salesOrderId`)
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

-- Estados del pedido: la misma tabla que `SALES_ORDER_TRANSITIONS`
-- (sales-order-states.ts). Por surtir o surtido en parte pasa a surtido en
-- parte, surtido o cancelado; surtido y cancelado ya no cambian.
DROP TRIGGER `sales_order_update_rules`;
CREATE TRIGGER `sales_order_update_rules` BEFORE UPDATE ON `sales_order` FOR EACH ROW
BEGIN
    IF NEW.`organizationId` <> OLD.`organizationId`
        OR NEW.`number` <> OLD.`number`
        OR NEW.`quoteId` <> OLD.`quoteId`
        OR NEW.`customerId` <> OLD.`customerId`
        OR NEW.`pricesIncludeTax` <> OLD.`pricesIncludeTax`
        OR NEW.`taxRate` <> OLD.`taxRate`
        OR NEW.`discountPercent` <> OLD.`discountPercent`
        OR NOT (NEW.`discountReason` <=> OLD.`discountReason`)
        OR NOT (NEW.`notes` <=> OLD.`notes`)
        OR NEW.`createdByUserId` <> OLD.`createdByUserId`
        OR NEW.`createdAt` <> OLD.`createdAt` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: what was agreed cannot change';
    END IF;
    IF NEW.`status` <> OLD.`status` AND NOT (
        OLD.`status` IN ('OPEN', 'PARTIAL') AND NEW.`status` IN ('PARTIAL', 'FULFILLED', 'CANCELLED')
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_order: that status change is not allowed';
    END IF;
END;
