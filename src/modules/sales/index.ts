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
export {
  NO_CASH_SESSION,
  SALE_KEY_REUSED,
  findSaleByKey,
  registerSale,
} from "./sales";
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
export {
  closeCashSession,
  getCashSession,
  getMyCashSession,
  listCashSessions,
  openCashSession,
  recordCashMovement,
} from "./cash";
export type { CashResult, CashSessionView } from "./cash";
export {
  cancelSale,
  findReturnByKey,
  getReturnableSale,
  returnSale,
} from "./returns";
export type {
  ReturnInput,
  ReturnResult,
  ReturnableLine,
  ReturnableSale,
} from "./returns";
export { SALE_PAGE_SIZE, listSaleCashiers, listSales } from "./history";
export type { SaleFilters, SalePage, SaleSummary } from "./history";
export {
  SALES_REPORT_KINDS,
  SALES_REPORT_MAX,
  buildSalesReport,
  getSalesReport,
  isSalesReportKind,
} from "./reports";
export type {
  ProductReportRow,
  SalesReport,
  SalesReportFile,
  SalesReportKind,
  SalesReportRow,
} from "./reports";
export {
  QUOTE_DEFAULT_DAYS,
  QUOTE_MAX_LINES,
  QUOTE_PAGE_SIZE,
  QUOTE_STATUS_LABELS,
  createQuote,
  defaultQuoteValidity,
  getQuote,
  listQuotes,
  previewQuote,
  updateQuote,
} from "./quotes";
export type {
  QuoteField,
  QuoteInput,
  QuotePreview,
  QuoteResult,
  QuoteStatus,
  QuoteSummary,
  QuoteView,
} from "./quotes";
export { buildQuotePdf, composeQuotePdf } from "./quote-pdf";
export type { QuotePdf } from "./quote-pdf";
export {
  QUOTE_DELIVERY_JOB_TYPE,
  QUOTE_DELIVERY_STATUS_LABELS,
  deliverQuote,
  getQuoteDeliveries,
  requestQuoteDelivery,
  salesJobHandlers,
} from "./quote-delivery";
export type {
  QuoteDelivery,
  QuoteDeliveryPanel,
  RequestQuoteDeliveryResult,
} from "./quote-delivery";
