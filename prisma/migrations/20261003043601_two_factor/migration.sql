-- AlterTable
ALTER TABLE `user` ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `twoFactor` (
    `id` CHAR(36) NOT NULL,
    `secret` TEXT NOT NULL,
    `backupCodes` TEXT NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `verified` BOOLEAN NOT NULL DEFAULT false,
    `failedVerificationCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,

    UNIQUE INDEX `twoFactor_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `twoFactor` ADD CONSTRAINT `twoFactor_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
