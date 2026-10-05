-- CreateTable
CREATE TABLE `stored_file` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `purpose` VARCHAR(40) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `contentType` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `storageKey` VARCHAR(100) NOT NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `stored_file_organizationId_purpose_createdAt_idx`(`organizationId`, `purpose`, `createdAt`),
    UNIQUE INDEX `stored_file_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stored_file` ADD CONSTRAINT `stored_file_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- A file has a size the storage could hold.
ALTER TABLE `stored_file` ADD CONSTRAINT `stored_file_size_check` CHECK (`size` > 0);
