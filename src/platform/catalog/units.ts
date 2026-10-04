/**
 * Units of measure (INV-05). A fixed catalog shared by every company: the
 * unit in which a product is controlled, grouped by dimension. Commercial
 * presentations (caja, rollo, saco) are not units: each company defines
 * them per product with its own content (INV-07).
 *
 * The same catalog is seeded in the `unit` table by migration; a test
 * fails when the code and the table differ. Pure: no database.
 */
import { Decimal, ValidationError, dec, type DecimalInput } from "@/lib";

export const DIMENSIONS = [
  "count",
  "mass",
  "length",
  "volume",
  "area",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_LABELS: Record<Dimension, string> = {
  count: "Conteo",
  mass: "Peso",
  length: "Longitud",
  volume: "Volumen",
  area: "Superficie",
};

export type Unit = {
  /** Stable identifier stored with products and movements. */
  code: string;
  dimension: Dimension;
  /** Singular and plural names shown to people. */
  name: string;
  plural: string;
  symbol: string;
  /** How many reference units of its dimension one of this unit is (exact). */
  toReference: string;
  /** Whether quantities may have decimals; things counted cannot. */
  fractional: boolean;
};

/** Reference unit of each dimension: pieza, kilogramo, metro, litro, metro cuadrado. */
export const UNITS = [
  {
    code: "piece",
    dimension: "count",
    name: "pieza",
    plural: "piezas",
    symbol: "pza",
    toReference: "1",
    fractional: false,
  },
  {
    code: "pair",
    dimension: "count",
    name: "par",
    plural: "pares",
    symbol: "par",
    toReference: "2",
    fractional: false,
  },
  {
    code: "dozen",
    dimension: "count",
    name: "docena",
    plural: "docenas",
    symbol: "doc",
    toReference: "12",
    fractional: false,
  },
  {
    code: "kg",
    dimension: "mass",
    name: "kilogramo",
    plural: "kilogramos",
    symbol: "kg",
    toReference: "1",
    fractional: true,
  },
  {
    code: "g",
    dimension: "mass",
    name: "gramo",
    plural: "gramos",
    symbol: "g",
    toReference: "0.001",
    fractional: true,
  },
  {
    code: "m",
    dimension: "length",
    name: "metro",
    plural: "metros",
    symbol: "m",
    toReference: "1",
    fractional: true,
  },
  {
    code: "cm",
    dimension: "length",
    name: "centímetro",
    plural: "centímetros",
    symbol: "cm",
    toReference: "0.01",
    fractional: true,
  },
  {
    code: "mm",
    dimension: "length",
    name: "milímetro",
    plural: "milímetros",
    symbol: "mm",
    toReference: "0.001",
    fractional: true,
  },
  {
    code: "l",
    dimension: "volume",
    name: "litro",
    plural: "litros",
    symbol: "L",
    toReference: "1",
    fractional: true,
  },
  {
    code: "ml",
    dimension: "volume",
    name: "mililitro",
    plural: "mililitros",
    symbol: "mL",
    toReference: "0.001",
    fractional: true,
  },
  {
    code: "m2",
    dimension: "area",
    name: "metro cuadrado",
    plural: "metros cuadrados",
    symbol: "m²",
    toReference: "1",
    fractional: true,
  },
] as const satisfies readonly Unit[];

export type UnitCode = (typeof UNITS)[number]["code"];

const byCode = new Map<string, Unit>(UNITS.map((unit) => [unit.code, unit]));

export function isUnitCode(value: unknown): value is UnitCode {
  return typeof value === "string" && byCode.has(value);
}

/** The unit of a code; throws ValidationError for an unknown one. */
export function getUnit(code: string): Unit {
  const unit = byCode.get(code);
  if (!unit) {
    throw new ValidationError("unknown_unit", "Esa unidad no existe.", {
      code,
    });
  }
  return unit;
}

/** Units of one dimension, in catalog order. */
export function unitsOfDimension(dimension: Dimension): Unit[] {
  return UNITS.filter((unit) => unit.dimension === dimension);
}

/** Whether two units measure the same kind of thing. */
export function areCompatible(a: string, b: string): boolean {
  return (
    byCode.has(a) &&
    byCode.has(b) &&
    getUnit(a).dimension === getUnit(b).dimension
  );
}

/**
 * Converts a quantity between units of the same dimension, exactly:
 * 2.5 kg → 2500 g, 3 docenas → 36 piezas. Kilos never become pieces, nor
 * liters kilos: incompatible units are refused.
 */
export function convertUnits(
  quantity: DecimalInput,
  from: string,
  to: string,
): Decimal {
  const source = getUnit(from);
  const target = getUnit(to);
  if (source.dimension !== target.dimension) {
    throw new ValidationError(
      "incompatible_units",
      `No se puede convertir de ${source.plural} a ${target.plural}: miden cosas distintas.`,
      { from, to },
    );
  }
  return dec(quantity).times(source.toReference).dividedBy(target.toReference);
}

/** "3 piezas", "1 kilogramo", "2.75 metros". */
export function formatQuantity(quantity: DecimalInput, code: string): string {
  const unit = getUnit(code);
  const value = dec(quantity);
  return `${value.toString()} ${value.equals(1) ? unit.name : unit.plural}`;
}
