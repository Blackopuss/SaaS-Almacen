-- CreateTable
CREATE TABLE `ownership_transfer` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `fromUserId` CHAR(36) NOT NULL,
    `toMembershipId` CHAR(36) NOT NULL,
    `previousOwnerRoles` JSON NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    INDEX `ownership_transfer_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `ownership_transfer_organizationId_toMembershipId_idx`(`organizationId`, `toMembershipId`),
    UNIQUE INDEX `ownership_transfer_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ownership_transfer` ADD CONSTRAINT `ownership_transfer_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ownership_transfer` ADD CONSTRAINT `ownership_transfer_organizationId_toMembershipId_fkey` FOREIGN KEY (`organizationId`, `toMembershipId`) REFERENCES `membership`(`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

