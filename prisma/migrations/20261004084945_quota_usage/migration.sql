-- CreateTable
CREATE TABLE `quota_usage` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `taken` INTEGER NOT NULL DEFAULT 0,
    `reserved` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `quota_usage_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `quota_usage_organizationId_key_key`(`organizationId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `quota_usage` ADD CONSTRAINT `quota_usage_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- A counter never goes below zero and never reserves more than it holds,
-- also for SQL that skips the application.
ALTER TABLE `quota_usage`
  ADD CONSTRAINT `quota_usage_values_check`
  CHECK (`taken` >= 0 AND `reserved` >= 0 AND `reserved` <= `taken`);
