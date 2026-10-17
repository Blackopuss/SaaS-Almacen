-- CreateTable
CREATE TABLE `membership_role` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `membershipId` CHAR(36) NOT NULL,
    `role` VARCHAR(40) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `membership_role_organizationId_membershipId_idx`(`organizationId`, `membershipId`),
    UNIQUE INDEX `membership_role_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `membership_role_membershipId_role_key`(`membershipId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `membership_organizationId_id_key` ON `membership`(`organizationId`, `id`);

-- AddForeignKey
ALTER TABLE `membership_role` ADD CONSTRAINT `membership_role_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_role` ADD CONSTRAINT `membership_role_organizationId_membershipId_fkey` FOREIGN KEY (`organizationId`, `membershipId`) REFERENCES `membership`(`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

