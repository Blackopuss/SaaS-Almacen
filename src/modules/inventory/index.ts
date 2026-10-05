// Public API of the inventory module: Units, locations, stock movements and balances (INV).
// Other modules and app/ may import only from this file.
export { inventoryModule } from "./contract";
export {
  MOVEMENT_TYPE_LABELS,
  findConfirmation,
  formatStock,
  getInitialBalanceState,
  getStockByLocation,
  getStockTotals,
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
