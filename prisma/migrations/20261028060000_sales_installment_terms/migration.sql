-- CreateTable
CREATE TABLE `sales_installment_term` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `months` INTEGER NOT NULL,
    `interestPercent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sales_installment_term_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `sales_installment_term_organizationId_months_key`(`organizationId`, `months`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sales_installment_term` ADD CONSTRAINT `sales_installment_term_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;



-- PAG-01 (ADR 0030): plazos de venta a plazos por empresa. Solo expansión.
ALTER TABLE `sales_installment_term` ADD CONSTRAINT `sales_installment_term_check` CHECK (
    `months` >= 1 AND `months` <= 60
    AND `interestPercent` >= 0 AND `interestPercent` <= 100
);
