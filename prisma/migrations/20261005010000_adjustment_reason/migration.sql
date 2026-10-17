-- Un ajuste siempre dice por qué se corrigieron las existencias (INV-24),
-- también si alguien escribe con SQL sin pasar por la aplicación.
ALTER TABLE `stock_movement` ADD CONSTRAINT `stock_movement_adjustment_reason_check` CHECK (
    `type` <> 'ADJUSTMENT' OR (`reason` IS NOT NULL AND CHAR_LENGTH(TRIM(`reason`)) >= 5)
);
