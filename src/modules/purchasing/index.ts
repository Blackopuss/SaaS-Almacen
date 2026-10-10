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
