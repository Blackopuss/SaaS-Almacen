-- AlterTable
ALTER TABLE `session` ADD COLUMN `activeOrganizationId` CHAR(36) NULL;

-- CreateIndex
CREATE INDEX `session_activeOrganizationId_idx` ON `session`(`activeOrganizationId`);

-- AddForeignKey
ALTER TABLE `session` ADD CONSTRAINT `session_activeOrganizationId_fkey` FOREIGN KEY (`activeOrganizationId`) REFERENCES `organization`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
