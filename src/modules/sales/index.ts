// Public API of the sales module: counter, cash, quotes and installments
// (VEN, COT, PAG). Other modules and app/ may import only from this file.
export { salesModule } from "./contract";
export { getSalePrices, setSalePrices } from "./prices";
export type {
  PriceRow,
  ProductPrices,
  SalesActor,
  SetPricesInput,
  SetPricesResult,
} from "./prices";
export { effectivePrice, formatMoney, parsePrice } from "./pricing";
export { getSalesSettings, updateSalesSettings } from "./settings";
export type {
  SalesSettings,
  SalesSettingsField,
  SalesSettingsInput,
  SalesSettingsResult,
} from "./settings";
export {
  DEFAULT_TAX_RULE,
  formatTaxRate,
  parseTaxRate,
  saleTotals,
} from "./tax";
export type { SaleTotals, TaxRule } from "./tax";
export { SALE_MAX_LINES, quoteSale } from "./cart";
export type { CartLineInput, CartQuote } from "./cart";
export { findSaleProducts, getSaleProduct } from "./sale-product";
export type { SaleProduct, SaleSearch } from "./sale-product";
export { SALE_KEY_REUSED, findSaleByKey, registerSale } from "./sales";
export type { SaleInput, SaleResult } from "./sales";
export {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  SALE_MAX_PAYMENTS,
  paymentNote,
  readPayments,
} from "./payments";
export type { PaymentInput, PaymentMethod } from "./payments";
export {
  DEFAULT_DISCOUNT_CAPS,
  formatPercent,
  parsePercent,
} from "./discounts";
export type { DiscountCaps } from "./discounts";
export {
  AUTHORIZATION_MINUTES,
  authorizeDiscount,
  listDiscountAuthorizers,
} from "./discount-authorization";
export type {
  AuthorizeDiscountResult,
  DiscountAuthorizer,
} from "./discount-authorization";
export { getPublicTicket, getSaleTicket, ticketPath } from "./ticket";
export type { Ticket } from "./ticket";
