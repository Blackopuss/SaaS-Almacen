// Public API of the purchasing module: Purchase orders, receipts and supplier returns (CMP).
// Other modules and app/ may import only from this file.
export { purchasingModule } from "./contract";
export {
  PRODUCT_SUPPLIER_PAGE_SIZE,
  getProductSupplier,
  linkProductSupplier,
  listProductsOfSupplier,
  listSuppliersOfProduct,
  recordLastCost,
  updateProductSupplier,
} from "./product-suppliers";
export type {
  ProductSupplierField,
  ProductSupplierInput,
  ProductSupplierLink,
  ProductSupplierList,
  PurchasingActor,
  SaveProductSupplierResult,
} from "./product-suppliers";
export {
  PURCHASE_ORDER_MAX_LINES,
  PURCHASE_ORDER_PAGE_SIZE,
  addOrderLine,
  advanceOrderOnReceipt,
  cancelPurchaseOrder,
  createPurchaseOrder,
  formatOrderNumber,
  getPurchaseOrder,
  listPurchaseOrders,
  removeOrderLine,
  submitPurchaseOrder,
  updateOrderLine,
  updatePurchaseOrder,
} from "./orders";
export type {
  CreateOrderResult,
  OrderFailure,
  OrderField,
  OrderHeaderInput,
  OrderLineInput,
  OrderTransitionResult,
  PurchaseOrderDetail,
  PurchaseOrderLine,
  PurchaseOrderPage,
  PurchaseOrderSummary,
} from "./orders";
export {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_TRANSITIONS,
  canTransition,
  isPurchaseOrderStatus,
  transitionProblem,
} from "./order-states";
export type { PurchaseOrderStatus } from "./order-states";
export { buildOrderPdf, type OrderPdf } from "./order-pdf";
export { closePurchaseOrder, type CloseOrderResult } from "./order-close";
export {
  generateSuggestedOrders,
  getPurchaseSuggestions,
  type GenerateSuggestedResult,
  type PurchaseSuggestions,
  type Suggestion,
  type SuggestionGroup,
} from "./suggestions";
export {
  findReturnConfirmation,
  returnToSupplier,
  type ReturnInput,
  type ReturnResult,
} from "./returns";
export {
  findReceiptConfirmation,
  getOrderReceipts,
  receivePurchaseOrder,
} from "./receipts";
export type {
  OrderReceipts,
  PendingLine,
  ReceiptSummary,
  ReceiveField,
  ReceiveInput,
  ReceiveResult,
} from "./receipts";
export {
  ORDER_DELIVERY_JOB_TYPE,
  ORDER_DELIVERY_MAX_ATTEMPTS,
  ORDER_DELIVERY_STATUS_LABELS,
  getOrderDeliveries,
  purchasingJobHandlers,
  requestOrderDelivery,
} from "./order-delivery";
export type {
  OrderDelivery,
  OrderDeliveryPanel,
  RequestDeliveryResult,
} from "./order-delivery";
