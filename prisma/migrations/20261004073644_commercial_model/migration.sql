-- CreateTable
CREATE TABLE `plan_version` (
    `id` CHAR(36) NOT NULL,
    `tier` VARCHAR(20) NOT NULL,
    `version` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `productLimit` INTEGER NOT NULL,
    `includedUsers` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MXN',
    `extraUserPrice` DECIMAL(12, 2) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `plan_version_tier_version_key`(`tier`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_offer` (
    `tier` VARCHAR(20) NOT NULL,
    `planVersionId` CHAR(36) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tier`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plan_module_price` (
    `id` CHAR(36) NOT NULL,
    `planVersionId` CHAR(36) NOT NULL,
    `moduleId` VARCHAR(40) NOT NULL,
    `monthlyPrice` DECIMAL(12, 2) NOT NULL,

    UNIQUE INDEX `plan_module_price_planVersionId_moduleId_key`(`planVersionId`, `moduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `planVersionId` CHAR(36) NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE', 'SUSPENDED', 'CANCELLED') NOT NULL DEFAULT 'TRIAL',
    `extraUsers` INTEGER NOT NULL DEFAULT 0,
    `currentPeriodStart` DATETIME(3) NOT NULL,
    `currentPeriodEnd` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscription_organizationId_key`(`organizationId`),
    INDEX `subscription_planVersionId_idx`(`planVersionId`),
    UNIQUE INDEX `subscription_organizationId_id_key`(`organizationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_item` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `subscriptionId` CHAR(36) NOT NULL,
    `moduleId` VARCHAR(40) NOT NULL,
    `monthlyPrice` DECIMAL(12, 2) NOT NULL,
    `activeFrom` DATETIME(3) NOT NULL,
    `activeUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `subscription_item_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `subscription_item_subscriptionId_moduleId_key`(`subscriptionId`, `moduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `entitlement` (
    `id` CHAR(36) NOT NULL,
    `organizationId` CHAR(36) NOT NULL,
    `kind` ENUM('MODULE', 'LIMIT') NOT NULL,
    `key` VARCHAR(40) NOT NULL,
    `value` INTEGER NULL,
    `validFrom` DATETIME(3) NOT NULL,
    `validUntil` DATETIME(3) NULL,
    `subscriptionId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `entitlement_organizationId_id_key`(`organizationId`, `id`),
    UNIQUE INDEX `entitlement_organizationId_kind_key_key`(`organizationId`, `kind`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `plan_offer` ADD CONSTRAINT `plan_offer_planVersionId_fkey` FOREIGN KEY (`planVersionId`) REFERENCES `plan_version`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plan_module_price` ADD CONSTRAINT `plan_module_price_planVersionId_fkey` FOREIGN KEY (`planVersionId`) REFERENCES `plan_version`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription` ADD CONSTRAINT `subscription_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription` ADD CONSTRAINT `subscription_planVersionId_fkey` FOREIGN KEY (`planVersionId`) REFERENCES `plan_version`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_item` ADD CONSTRAINT `subscription_item_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_item` ADD CONSTRAINT `subscription_item_organizationId_subscriptionId_fkey` FOREIGN KEY (`organizationId`, `subscriptionId`) REFERENCES `subscription`(`organizationId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entitlement` ADD CONSTRAINT `entitlement_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `entitlement` ADD CONSTRAINT `entitlement_organizationId_subscriptionId_fkey` FOREIGN KEY (`organizationId`, `subscriptionId`) REFERENCES `subscription`(`organizationId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Versioned conditions (MOD-03): a plan version and its prices never change
-- once written; a new price or limit is a new version. The application user
-- cannot alter them either.
CREATE TRIGGER `plan_version_no_update` BEFORE UPDATE ON `plan_version` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan_version is immutable: create a new version';
CREATE TRIGGER `plan_version_no_delete` BEFORE DELETE ON `plan_version` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan_version is immutable: create a new version';
CREATE TRIGGER `plan_module_price_no_update` BEFORE UPDATE ON `plan_module_price` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan_module_price is immutable: create a new version';
CREATE TRIGGER `plan_module_price_no_delete` BEFORE DELETE ON `plan_module_price` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'plan_module_price is immutable: create a new version';

-- Sane values, also for SQL that skips the application.
ALTER TABLE `plan_version`
  ADD CONSTRAINT `plan_version_values_check`
  CHECK (`version` >= 1 AND `productLimit` >= 1 AND `includedUsers` >= 1 AND `extraUserPrice` >= 0);
ALTER TABLE `plan_module_price`
  ADD CONSTRAINT `plan_module_price_value_check` CHECK (`monthlyPrice` >= 0);
ALTER TABLE `subscription`
  ADD CONSTRAINT `subscription_values_check`
  CHECK (`extraUsers` >= 0 AND `currentPeriodEnd` > `currentPeriodStart`);
ALTER TABLE `subscription_item`
  ADD CONSTRAINT `subscription_item_values_check`
  CHECK (`monthlyPrice` >= 0 AND (`activeUntil` IS NULL OR `activeUntil` >= `activeFrom`));
ALTER TABLE `entitlement`
  ADD CONSTRAINT `entitlement_value_check`
  CHECK ((`kind` = 'MODULE' AND `value` IS NULL) OR (`kind` = 'LIMIT' AND `value` IS NOT NULL AND `value` >= 0));
ALTER TABLE `entitlement`
  ADD CONSTRAINT `entitlement_period_check`
  CHECK (`validUntil` IS NULL OR `validUntil` > `validFrom`);
