-- CreateTable
CREATE TABLE `job` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `type` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(64) NULL,
    `lastError` VARCHAR(500) NULL,
    `result` JSON NULL,
    `createdByUserId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,

    INDEX `job_status_runAt_idx`(`status`, `runAt`),
    INDEX `job_organizationId_type_createdAt_idx`(`organizationId`, `type`, `createdAt`),
    UNIQUE INDEX `job_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `job` ADD CONSTRAINT `job_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Attempts are bounded: a job never retries forever.
ALTER TABLE `job` ADD CONSTRAINT `job_attempts_check` CHECK (`maxAttempts` BETWEEN 1 AND 20 AND `attempts` BETWEEN 0 AND `maxAttempts`);

-- A job that ended says when; one that has not, does not.
ALTER TABLE `job` ADD CONSTRAINT `job_finished_check` CHECK ((`status` IN ('DONE', 'FAILED')) = (`finishedAt` IS NOT NULL));
