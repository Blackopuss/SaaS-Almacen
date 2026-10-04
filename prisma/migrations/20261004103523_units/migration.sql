-- CreateTable
CREATE TABLE `unit` (
    `code` VARCHAR(12) NOT NULL,
    `dimension` VARCHAR(12) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `plural` VARCHAR(40) NOT NULL,
    `symbol` VARCHAR(8) NOT NULL,
    `toReference` DECIMAL(18, 9) NOT NULL,
    `fractional` BOOLEAN NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- Catalog of units (INV-05). Same rows as UNITS in
-- src/platform/catalog/units.ts; a new unit needs a migration and the code.
INSERT INTO `unit` (`code`, `dimension`, `name`, `plural`, `symbol`, `toReference`, `fractional`) VALUES
  ('piece', 'count',  'pieza',          'piezas',           'pza', 1,     false),
  ('pair',  'count',  'par',            'pares',            'par', 2,     false),
  ('dozen', 'count',  'docena',         'docenas',          'doc', 12,    false),
  ('kg',    'mass',   'kilogramo',      'kilogramos',       'kg',  1,     true),
  ('g',     'mass',   'gramo',          'gramos',           'g',   0.001, true),
  ('m',     'length', 'metro',          'metros',           'm',   1,     true),
  ('cm',    'length', 'centímetro',     'centímetros',      'cm',  0.01,  true),
  ('mm',    'length', 'milímetro',      'milímetros',       'mm',  0.001, true),
  ('l',     'volume', 'litro',          'litros',           'L',   1,     true),
  ('ml',    'volume', 'mililitro',      'mililitros',       'mL',  0.001, true),
  ('m2',    'area',   'metro cuadrado', 'metros cuadrados', 'm²',  1,     true);

ALTER TABLE `unit`
  ADD CONSTRAINT `unit_values_check`
  CHECK (`toReference` > 0 AND `dimension` IN ('count', 'mass', 'length', 'volume', 'area'));
