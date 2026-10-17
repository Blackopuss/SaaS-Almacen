-- CreateTable
CREATE TABLE `auth_throttle` (
    `key` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `blockedUntil` DATETIME(3) NULL,

    INDEX `auth_throttle_windowStart_idx`(`windowStart`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rateLimit` (
    `id` CHAR(36) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `count` INTEGER NOT NULL,
    `lastRequest` BIGINT NOT NULL,

    UNIQUE INDEX `rateLimit_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
