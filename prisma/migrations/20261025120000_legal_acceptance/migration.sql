-- CreateTable
CREATE TABLE `legal_acceptance` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `document` VARCHAR(20) NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `acceptedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(500) NULL,

    UNIQUE INDEX `legal_acceptance_userId_document_version_key`(`userId`, `document`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Acceptances of legal documents (PIL-09) are proof: append-only, like
-- security_event.
CREATE TRIGGER `legal_acceptance_no_update` BEFORE UPDATE ON `legal_acceptance` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'legal_acceptance is append-only';
CREATE TRIGGER `legal_acceptance_no_delete` BEFORE DELETE ON `legal_acceptance` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'legal_acceptance is append-only';
