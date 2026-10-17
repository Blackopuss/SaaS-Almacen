-- Jerarquía de ubicaciones (INV-14): zonas, pasillos y estantes dentro de la
-- instalación. El tipo define el orden (zona > pasillo > estante) y una
-- ubicación solo puede ir dentro de otra de tipo más amplio: así un ciclo es
-- imposible de construir, sin importar el orden de las escrituras.

-- AlterTable
-- Las filas que ya existen son las «General» de INV-13; cualquier otra
-- quedaría como zona en la raíz.
ALTER TABLE `location` ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `kind` ENUM('GENERAL', 'ZONE', 'AISLE', 'SHELF') NOT NULL DEFAULT 'ZONE',
    ADD COLUMN `parentId` CHAR(36) NULL;
UPDATE `location` SET `kind` = 'GENERAL' WHERE `isDefault` = 1;
ALTER TABLE `location` ALTER COLUMN `kind` DROP DEFAULT;

-- CreateIndex (antes de quitar el anterior: las llaves foráneas siempre
-- conservan un índice que las respalde).
CREATE UNIQUE INDEX `location_organizationId_facilityId_id_key` ON `location`(`organizationId`, `facilityId`, `id`);
CREATE UNIQUE INDEX `location_organizationId_facilityId_parentId_name_key` ON `location`(`organizationId`, `facilityId`, `parentId`, `name`);

-- DropIndex
-- El nombre deja de ser único en toda la instalación: «Estante 1» puede
-- existir en dos pasillos. Sigue siendo único dentro de su ubicación padre.
DROP INDEX `location_organizationId_facilityId_name_key` ON `location`;

-- AddForeignKey
-- El padre pertenece a la misma empresa y a la misma instalación.
ALTER TABLE `location` ADD CONSTRAINT `location_organizationId_facilityId_parentId_fkey` FOREIGN KEY (`organizationId`, `facilityId`, `parentId`) REFERENCES `location`(`organizationId`, `facilityId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- «General» y solo ella es la ubicación por defecto: va en la raíz y no se
-- archiva. (Su nombre exacto ya lo exige location_default_check.)
ALTER TABLE `location` ADD CONSTRAINT `location_general_check` CHECK (
    (`isDefault` IS NULL AND `kind` <> 'GENERAL')
    OR (`isDefault` = 1 AND `kind` = 'GENERAL' AND `parentId` IS NULL AND `archivedAt` IS NULL)
);
ALTER TABLE `location` ADD CONSTRAINT `location_parent_check` CHECK (`parentId` IS NULL OR `parentId` <> `id`);

-- Reglas que necesitan mirar otra fila. Los servicios las comprueban antes,
-- con la instalación bloqueada, y dan el mensaje para la persona; estos
-- disparadores son la última defensa ante una escritura directa.
CREATE TRIGGER `location_tree_insert` BEFORE INSERT ON `location` FOR EACH ROW
BEGIN
    DECLARE parent_kind VARCHAR(10);
    IF NEW.`parentId` IS NOT NULL THEN
        SELECT `kind` INTO parent_kind FROM `location` WHERE `id` = NEW.`parentId`;
        IF parent_kind IS NULL
            OR FIELD(parent_kind, 'ZONE', 'AISLE', 'SHELF') = 0
            OR FIELD(parent_kind, 'ZONE', 'AISLE', 'SHELF') >= FIELD(NEW.`kind`, 'ZONE', 'AISLE', 'SHELF') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'location_tree: a location only goes inside a coarser kind';
        END IF;
    ELSEIF EXISTS (
        SELECT 1 FROM `location`
        WHERE `organizationId` = NEW.`organizationId` AND `facilityId` = NEW.`facilityId`
            AND `parentId` IS NULL AND `name` = NEW.`name`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'location_tree: name repeated at the root of the facility';
    END IF;
END;

CREATE TRIGGER `location_tree_update` BEFORE UPDATE ON `location` FOR EACH ROW
BEGIN
    DECLARE parent_kind VARCHAR(10);
    IF NEW.`kind` <> OLD.`kind` THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'location_tree: the kind of a location never changes';
    END IF;
    IF OLD.`isDefault` = 1 AND NEW.`isDefault` IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'location_tree: General is always the default location';
    END IF;
    IF NEW.`parentId` IS NOT NULL THEN
        SELECT `kind` INTO parent_kind FROM `location` WHERE `id` = NEW.`parentId`;
        IF parent_kind IS NULL
            OR FIELD(parent_kind, 'ZONE', 'AISLE', 'SHELF') = 0
            OR FIELD(parent_kind, 'ZONE', 'AISLE', 'SHELF') >= FIELD(NEW.`kind`, 'ZONE', 'AISLE', 'SHELF') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'location_tree: a location only goes inside a coarser kind';
        END IF;
    ELSEIF EXISTS (
        SELECT 1 FROM `location`
        WHERE `organizationId` = NEW.`organizationId` AND `facilityId` = NEW.`facilityId`
            AND `parentId` IS NULL AND `name` = NEW.`name` AND `id` <> NEW.`id`
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'location_tree: name repeated at the root of the facility';
    END IF;
END;

-- Nada se borra: una ubicación con historia se archiva.
CREATE TRIGGER `location_no_delete` BEFORE DELETE ON `location` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'location is never deleted: archive it';
