-- CreateTable
CREATE TABLE `audit_event` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `actorUserId` CHAR(36) NULL,
    `action` VARCHAR(80) NOT NULL,
    `targetType` VARCHAR(40) NULL,
    `targetId` VARCHAR(64) NULL,
    `reason` VARCHAR(500) NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_event_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `audit_event_organizationId_targetType_targetId_idx`(`organizationId`, `targetType`, `targetId`),
    UNIQUE INDEX `audit_event_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `security_event` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `action` VARCHAR(80) NOT NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `security_event_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `audit_event` ADD CONSTRAINT `audit_event_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Append-only audit log (PLT-14): no user, the application included, may
-- change or delete events. Removing a company's history is a deliberate
-- maintenance task that drops these triggers first.
CREATE TRIGGER `audit_event_no_update` BEFORE UPDATE ON `audit_event` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only';
CREATE TRIGGER `audit_event_no_delete` BEFORE DELETE ON `audit_event` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_event is append-only';
CREATE TRIGGER `security_event_no_update` BEFORE UPDATE ON `security_event` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'security_event is append-only';
CREATE TRIGGER `security_event_no_delete` BEFORE DELETE ON `security_event` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'security_event is append-only';
