-- AlterTable
ALTER TABLE `stock_count` ADD COLUMN `appliedMovementId` CHAR(36) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `stock_count_organizationId_appliedMovementId_key` ON `stock_count`(`organizationId`, `appliedMovementId`);

-- AddForeignKey
ALTER TABLE `stock_count` ADD CONSTRAINT `stock_count_organizationId_appliedMovementId_fkey` FOREIGN KEY (`organizationId`, `appliedMovementId`) REFERENCES `stock_movement`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

