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
  registerEntry,
  registerExit,
  registerInitialBalance,
  registerTransfer,
} from "./movements";
export type {
  EntryField,
  EntryInput,
  InventoryActor,
  MovementResult,
  MovementSummary,
  MovementType,
  PendingInitialBalance,
  TransferField,
  TransferInput,
  TransferResult,
} from "./movements";
export { reconcileStock } from "./reconciliation";
export type { StockDrift } from "./reconciliation";
