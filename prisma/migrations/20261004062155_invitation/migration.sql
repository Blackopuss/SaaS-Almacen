-- CreateTable
CREATE TABLE `invitation` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `roles` JSON NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `invitedByUserId` CHAR(36) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    UNIQUE INDEX `invitation_tokenHash_key`(`tokenHash`),
    INDEX `invitation_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `invitation_organizationId_email_idx`(`organizationId`, `email`),
    UNIQUE INDEX `invitation_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `invitation` ADD CONSTRAINT `invitation_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

