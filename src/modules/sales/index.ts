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
export type { SalesSettingsInput, SalesSettingsResult } from "./settings";
export {
  DEFAULT_TAX_RULE,
  formatTaxRate,
  parseTaxRate,
  saleTotals,
} from "./tax";
export type { SaleTotals, TaxRule } from "./tax";
