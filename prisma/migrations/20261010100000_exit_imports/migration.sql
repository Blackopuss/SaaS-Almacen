-- CreateTable
CREATE TABLE `exit_import` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `fileId` CHAR(36) NOT NULL,
    `status` ENUM('READY', 'CONFIRMED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'READY',
    `decimalSeparator` CHAR(1) NOT NULL,
    `dataRows` INTEGER NOT NULL,
    `totalRows` INTEGER NOT NULL DEFAULT 0,
    `appliedRows` INTEGER NOT NULL DEFAULT 0,
    `duplicateRows` INTEGER NOT NULL DEFAULT 0,
    `failedRows` INTEGER NOT NULL DEFAULT 0,
    `firstDay` DATE NULL,
    `lastDay` DATE NULL,
    `confirmedAt` DATETIME(3) NULL,
    `confirmedByUserId` CHAR(36) NULL,
    `finishedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `createdByUserId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `exit_import_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    UNIQUE INDEX `exit_import_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `exit_import_row` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `importId` CHAR(36) NOT NULL,
    `row` INTEGER NOT NULL,
    `externalId` VARCHAR(64) NOT NULL,
    `day` DATE NOT NULL,
    `productId` CHAR(36) NOT NULL,
    `presentationId` CHAR(36) NULL,
    `quantity` VARCHAR(24) NOT NULL,
    `locationId` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'DONE', 'DUPLICATE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `error` VARCHAR(300) NULL,
    `movementId` CHAR(36) NULL,
    `appliedAt` DATETIME(3) NULL,
    `appliedKey` VARCHAR(120) NULL,

    INDEX `exit_import_row_organizationId_importId_status_row_idx`(`organizationId`, `importId`, `status`, `row`),
    INDEX `exit_import_row_organizationId_status_day_idx`(`organizationId`, `status`, `day`),
    UNIQUE INDEX `exit_import_row_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `exit_import_row_organizationId_importId_row_key`(`organizationId`, `importId`, `row`),
    UNIQUE INDEX `exit_import_row_organizationId_appliedKey_key`(`organizationId`, `appliedKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `exit_import` ADD CONSTRAINT `exit_import_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exit_import` ADD CONSTRAINT `exit_import_organizationId_fileId_fkey` FOREIGN KEY (`organizationId`, `fileId`) REFERENCES `stored_file`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exit_import_row` ADD CONSTRAINT `exit_import_row_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exit_import_row` ADD CONSTRAINT `exit_import_row_organizationId_importId_fkey` FOREIGN KEY (`organizationId`, `importId`) REFERENCES `exit_import`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exit_import_row` ADD CONSTRAINT `exit_import_row_organizationId_productId_fkey` FOREIGN KEY (`organizationId`, `productId`) REFERENCES `product`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `exit_import_row` ADD CONSTRAINT `exit_import_row_organizationId_locationId_fkey` FOREIGN KEY (`organizationId`, `locationId`) REFERENCES `location`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Lo procesado nunca rebasa el total, y cada contador es no negativo.
ALTER TABLE `exit_import` ADD CONSTRAINT `exit_import_progress_check` CHECK (
    `appliedRows` >= 0 AND `duplicateRows` >= 0 AND `failedRows` >= 0
    AND `appliedRows` + `duplicateRows` + `failedRows` <= `totalRows`
);

-- La clave que impide descontar dos veces existe solo en las filas aplicadas.
ALTER TABLE `exit_import_row` ADD CONSTRAINT `exit_import_row_applied_check` CHECK (
    (`status` = 'DONE') = (COALESCE(`appliedKey`, '') <> '')
    AND (`status` = 'DONE') = (COALESCE(`movementId`, '') <> '')
);
