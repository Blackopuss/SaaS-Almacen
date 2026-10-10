-- AlterTable
ALTER TABLE `job` ADD COLUMN `failureHandledAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `job_status_failureHandledAt_idx` ON `job`(`status`, `failureHandledAt`);

-- Jobs that had already failed before this step have nothing left to give
-- back that this mechanism knows of: they are not looked at again.
UPDATE `job` SET `failureHandledAt` = COALESCE(`finishedAt`, CURRENT_TIMESTAMP(3)) WHERE `status` = 'FAILED';
