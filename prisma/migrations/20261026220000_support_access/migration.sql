-- CreateTable
CREATE TABLE `support_access` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `grantedByUserId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedByUserId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `support_access_organizationId_expiresAt_idx`(`organizationId`, `expiresAt`),
    UNIQUE INDEX `support_access_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `support_access` ADD CONSTRAINT `support_access_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- PIL-12: acceso de soporte de solo lectura, abierto por el titular por un
-- tiempo fijo (como mucho 7 días) y cerrado por él o por el tiempo.
ALTER TABLE `support_access`
  ADD CONSTRAINT `support_access_window` CHECK (
    `expiresAt` > `createdAt`
    AND `expiresAt` <= `createdAt` + INTERVAL 7 DAY
  ),
  ADD CONSTRAINT `support_access_revoked_shape` CHECK (
    (`revokedAt` IS NULL AND `revokedByUserId` IS NULL)
    OR (`revokedAt` IS NOT NULL AND `revokedByUserId` IS NOT NULL)
  );

-- Registro: nada se borra; lo único que cambia es cerrarlo, una sola vez.
CREATE TRIGGER `support_access_no_delete` BEFORE DELETE ON `support_access` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'support_access is a record';
CREATE TRIGGER `support_access_close_once` BEFORE UPDATE ON `support_access` FOR EACH ROW BEGIN
  IF OLD.`revokedAt` IS NOT NULL
    OR NOT (NEW.`id` <=> OLD.`id`)
    OR NOT (NEW.`organizationId` <=> OLD.`organizationId`)
    OR NOT (NEW.`grantedByUserId` <=> OLD.`grantedByUserId`)
    OR NOT (NEW.`expiresAt` <=> OLD.`expiresAt`)
    OR NOT (NEW.`createdAt` <=> OLD.`createdAt`) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'support_access only closes once';
  END IF;
END;
