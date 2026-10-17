-- CreateTable
CREATE TABLE `organization` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `timeZone` VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
    `currency` CHAR(3) NOT NULL DEFAULT 'MXN',
    `ownerUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `organization_ownerUserId_idx`(`ownerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `membership_userId_idx`(`userId`),
    UNIQUE INDEX `membership_organizationId_userId_key`(`organizationId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `organization` ADD CONSTRAINT `organization_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership` ADD CONSTRAINT `membership_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership` ADD CONSTRAINT `membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
