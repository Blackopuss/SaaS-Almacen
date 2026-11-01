-- Recordatorios enviados a mano desde la cuenta (decisión del fundador,
-- 2026-11-01), además de los automáticos de PAG-07. Solo expansión: el
-- automático sigue siendo uno por mensualidad (un disparador copia la
-- mensualidad a `autoInstallment`, también si lo inserta la versión
-- anterior); los manuales la dejan en NULL y no chocan entre sí.
ALTER TABLE `sales_receivable_reminder`
    ADD COLUMN `autoInstallment` INTEGER NULL,
    ADD COLUMN `requestedByUserId` CHAR(36) NULL;

DROP TRIGGER `sales_receivable_reminder_final`;
UPDATE `sales_receivable_reminder` SET `autoInstallment` = `installmentNumber`;

CREATE UNIQUE INDEX `sales_receivable_reminder_organizationId_receivableId_autoIn_key` ON `sales_receivable_reminder`(`organizationId`, `receivableId`, `autoInstallment`);
CREATE INDEX `sales_receivable_reminder_organizationId_receivableId_reques_idx` ON `sales_receivable_reminder`(`organizationId`, `receivableId`, `requestedAt`);
DROP INDEX `sales_receivable_reminder_organizationId_receivableId_instal_key` ON `sales_receivable_reminder`;

CREATE TRIGGER `sales_receivable_reminder_insert_rules` BEFORE INSERT ON `sales_receivable_reminder` FOR EACH ROW
    SET NEW.`autoInstallment` = IF(NEW.`requestedByUserId` IS NULL, NEW.`installmentNumber`, NULL);

CREATE TRIGGER `sales_receivable_reminder_final` BEFORE UPDATE ON `sales_receivable_reminder` FOR EACH ROW
BEGIN
    IF OLD.`status` <> 'QUEUED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_reminder: a finished reminder cannot change';
    END IF;
    IF NEW.`receivableId` <> OLD.`receivableId` OR NEW.`installmentNumber` <> OLD.`installmentNumber`
        OR NEW.`recipient` <> OLD.`recipient` OR NEW.`jobId` <> OLD.`jobId` OR NEW.`requestedAt` <> OLD.`requestedAt`
        OR NOT (NEW.`requestedByUserId` <=> OLD.`requestedByUserId`)
        OR NOT (NEW.`autoInstallment` <=> OLD.`autoInstallment`) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sales_receivable_reminder: its data cannot change';
    END IF;
END;
