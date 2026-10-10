// Public API of platform/contacts: customers and suppliers shared by
// Purchasing, Sales and CRM (CMP-01).
export { CONTACT_FACETS, CONTACT_FACET_LABELS, isContactFacet } from "./facets";
export type { ContactFacet } from "./facets";
export {
  SUPPLIER_PAGE_SIZE,
  createSupplier,
  getSupplier,
  listSuppliers,
  normalizeRfc,
  supplierSchema,
  updateSupplier,
} from "./suppliers";
export type {
  ContactActor,
  SaveSupplierResult,
  SupplierDetail,
  SupplierDuplicate,
  SupplierField,
  SupplierInput,
  SupplierPage,
  SupplierSummary,
} from "./suppliers";
