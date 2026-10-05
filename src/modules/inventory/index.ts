// Public API of the inventory module: Units, locations, stock movements and balances (INV).
// Other modules and app/ may import only from this file.
export { inventoryModule } from "./contract";
export {
  MOVEMENT_PAGE_SIZE,
  MOVEMENT_TYPE_LABELS,
  findConfirmation,
  formatStock,
  getInitialBalanceState,
  getStockByLocation,
  getStockTotals,
  listMovementAuthors,
  listMovements,
  listProductsWithoutStock,
  listRecentMovements,
  listStockLocations,
  registerAdjustment,
  registerEntry,
  registerExit,
  registerInitialBalance,
  registerTransfer,
  reverseMovement,
} from "./movements";
export type {
  AdjustmentInput,
  EntryField,
  EntryInput,
  InventoryActor,
  MovementFilters,
  MovementPage,
  MovementResult,
  MovementSummary,
  MovementType,
  PendingInitialBalance,
  ReversalInput,
  ReversalResult,
  TransferField,
  TransferInput,
  TransferResult,
} from "./movements";
export { reconcileStock } from "./reconciliation";
export type { StockDrift } from "./reconciliation";
export { getProductStock } from "./product-stock";
export type { ProductStock } from "./product-stock";
export {
  QUICK_EXIT_MAX_LINES,
  registerQuickExit,
  type QuickExitField,
  type QuickExitInput,
  type QuickExitResult,
} from "./quick-exit";
export {
  LOW_STOCK_PAGE_SIZE,
  countLowStock,
  getMinimum,
  listLowStock,
  setMinimum,
  type LowStockItem,
  type LowStockPage,
  type SetMinimumResult,
} from "./minimums";
export {
  COUNT_MAX_LINES,
  COUNT_STATUS_LABELS,
  applyCount,
  cancelCount,
  captureCount,
  getCount,
  listCounts,
  openCount,
  removeCapture,
  type ApplyCountResult,
  type CaptureInput,
  type CaptureResult,
  type CountChangeResult,
  type CountDetail,
  type CountLine,
  type CountStatus,
  type CountSummary,
  type OpenCountResult,
} from "./counts";
export { reconcileCompany, type ReconciliationReport } from "./reconciliation";
export {
  IMPORT_COLUMNS,
  buildImportTemplate,
  type ImportColumnKey,
  type ImportTemplate,
  type ImportTemplateFormat,
} from "./import-template";
export {
  NUMERIC_IMPORT_COLUMNS,
  getImport,
  listImports,
  normalizeDecimal,
  saveImportMapping,
  startImport,
  suggestMapping,
  type DecimalSeparator,
  type ImportDetail,
  type ImportMapping,
  type ImportSummary,
  type SaveMappingResult,
  type StartImportResult,
} from "./imports";
