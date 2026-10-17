// Physical facilities and locations shared by Inventario and Compras.
export { ensureDefaultLocation } from "./bootstrap";
export {
  MAX_LOCATIONS,
  archiveLocation,
  createLocation,
  listLocations,
  moveLocation,
  renameLocation,
  restoreLocation,
} from "./hierarchy";
export type {
  LocationField,
  LocationNode,
  LocationResult,
  LocationTree,
} from "./hierarchy";
export {
  LOCATION_KINDS,
  LOCATION_KIND_LABELS,
  LOCATION_PATH_SEPARATOR,
  canContain,
  compareLocationNames,
  formatLocationPath,
  isLocationKind,
  kindsInside,
} from "./kinds";
export type { AnyLocationKind, LocationKind } from "./kinds";
export { getDefaultLocation } from "./locations";
export type { LocationActor } from "./locations";
