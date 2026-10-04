// Public API of platform/catalog: Products and the shared active-product quota (INV).
export {
  archiveProduct,
  createProduct,
  getProduct,
  listProductGroups,
  listRecentProducts,
  productSchema,
  quotaMessage,
  reactivateProduct,
  updateProduct,
} from "./products";
export type {
  CatalogActor,
  CreateProductResult,
  ProductCard,
  ProductField,
  ProductInput,
  ProductStatusResult,
  ProductSummary,
  UpdateProductResult,
} from "./products";
export {
  DIMENSIONS,
  DIMENSION_LABELS,
  UNITS,
  areCompatible,
  convertUnits,
  formatQuantity,
  getUnit,
  isUnitCode,
  unitsOfDimension,
} from "./units";
export type { Dimension, Unit, UnitCode } from "./units";
export {
  MAX_QUANTITY,
  QUANTITY_SCALE,
  QUANTITY_STEPS,
  STEP_LABELS,
  defaultStep,
  parseQuantity,
  stepProblem,
  stepsForUnit,
} from "./quantity";
export type { ParsedQuantity, QuantityRule, QuantityStep } from "./quantity";
export { createPresentation, listPresentations } from "./presentations";
export type {
  Presentation,
  PresentationField,
  PresentationResult,
} from "./presentations";
