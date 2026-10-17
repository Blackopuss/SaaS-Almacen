/**
 * Kinds of location and the order between them (INV-14). Pure rules, shared
 * by the services, the screens and the tests.
 *
 * A zone holds aisles and shelves, an aisle holds shelves and a shelf holds
 * nothing. Levels are optional: any kind may hang directly from the
 * facility. Because a location only goes inside a coarser kind, a cycle
 * cannot exist, whatever the order of the writes.
 */

/** Kinds a business can create, from the widest to the finest. */
export const LOCATION_KINDS = ["ZONE", "AISLE", "SHELF"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** `GENERAL` is the default location of the facility: nobody creates it. */
export type AnyLocationKind = LocationKind | "GENERAL";

export const LOCATION_KIND_LABELS: Record<AnyLocationKind, string> = {
  GENERAL: "General",
  ZONE: "Zona",
  AISLE: "Pasillo",
  SHELF: "Estante",
};

export function isLocationKind(value: unknown): value is LocationKind {
  return (LOCATION_KINDS as readonly unknown[]).includes(value);
}

const rank = (kind: AnyLocationKind) =>
  LOCATION_KINDS.indexOf(kind as LocationKind);

/** Whether a location of kind `child` may go inside one of kind `parent`. */
export function canContain(
  parent: AnyLocationKind,
  child: AnyLocationKind,
): boolean {
  return rank(parent) >= 0 && rank(child) > rank(parent);
}

/** Kinds that may be created inside a parent (`null` = the facility itself). */
export function kindsInside(parent: AnyLocationKind | null): LocationKind[] {
  return parent === null
    ? [...LOCATION_KINDS]
    : LOCATION_KINDS.filter((kind) => canContain(parent, kind));
}

/** Between the names of a path: «Zona A › Pasillo 2 › Estante 3». */
export const LOCATION_PATH_SEPARATOR = " › ";

export function formatLocationPath(names: readonly string[]): string {
  return names.join(LOCATION_PATH_SEPARATOR);
}

/** «Pasillo 2» before «Pasillo 10», without distinguishing capitals or accents. */
export function compareLocationNames(a: string, b: string): number {
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}
