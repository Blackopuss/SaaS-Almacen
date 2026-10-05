-- Una reversa siempre dice por qué se deshizo el movimiento (INV-25),
-- también si alguien escribe con SQL sin pasar por la aplicación.
ALTER TABLE `stock_movement` ADD CONSTRAINT `stock_movement_reversal_reason_check` CHECK (
    `type` <> 'REVERSAL' OR (`reason` IS NOT NULL AND CHAR_LENGTH(TRIM(`reason`)) >= 5)
);
