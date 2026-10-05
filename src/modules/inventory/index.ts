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
