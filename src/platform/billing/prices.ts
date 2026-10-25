import { dec, type Decimal } from "@/lib";

/**
 * Price list of the online purchase (ADR 0028). The single source of the
 * amounts a customer pays: the public site shows these same prices and the
 * checkout computes every total here, on the server. Prices are monthly,
 * in MXN, before VAT; a proposal until the founder confirms them (FUN-06).
 * Pure: no database.
 */

export const PLAN_TIERS = [
  {
    id: "t100",
    productLimit: 100,
    users: 2,
    prices: { inventory: "349.00", purchasing: "179.00" },
  },
  {
    id: "t500",
    productLimit: 500,
    users: 3,
    prices: { inventory: "649.00", purchasing: "299.00" },
  },
  {
    id: "t1000",
    productLimit: 1000,
    users: 5,
    prices: { inventory: "949.00", purchasing: "449.00" },
  },
  {
    id: "t3000",
    productLimit: 3000,
    users: 8,
    prices: { inventory: "1690.00", purchasing: "790.00" },
  },
  {
    id: "t10000",
    productLimit: 10000,
    users: 15,
    prices: { inventory: "3490.00", purchasing: "1490.00" },
  },
] as const;

export type PlanTier = (typeof PLAN_TIERS)[number];
export type PlanTierId = PlanTier["id"];
/** Modules sold online. Inventory is the base and always included. */
export type SoldModule = keyof PlanTier["prices"];

/** How many months can be bought at once. */
export const PURCHASE_MONTHS = [1, 3, 6, 12] as const;
export type PurchaseMonths = (typeof PURCHASE_MONTHS)[number];

/** IVA in Mexico. Prices are before VAT; the customer pays it on top. */
export const TAX_RATE = "0.16";

export function findTier(id: string): PlanTier | null {
  return PLAN_TIERS.find((tier) => tier.id === id) ?? null;
}

export function isPurchaseMonths(value: number): value is PurchaseMonths {
  return (PURCHASE_MONTHS as readonly number[]).includes(value);
}

export type Quote = {
  /** Monthly price of what was chosen, before VAT. */
  monthly: string;
  /** monthly × months. */
  subtotal: string;
  /** Discount of a code, taken from the subtotal. */
  discount: string;
  tax: string;
  total: string;
};

const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);

/**
 * What a purchase costs: the monthly price of the tier and its modules
 * times the months, minus a code's discount (a whole percentage), plus VAT
 * on what remains. Rounded to cents once per step, half up.
 */
export function quote(
  tier: PlanTier,
  modules: readonly SoldModule[],
  months: PurchaseMonths,
  percentOff = 0,
): Quote {
  if (!Number.isInteger(percentOff) || percentOff < 0 || percentOff > 100) {
    throw new Error(`percentOff must be 0..100, got ${percentOff}`);
  }
  const chosen = new Set<SoldModule>(["inventory", ...modules]);
  let monthly = dec(0);
  for (const moduleId of chosen) monthly = monthly.plus(tier.prices[moduleId]);
  const subtotal = monthly.times(months);
  const discount = dec(money(subtotal.times(percentOff).dividedBy(100)));
  const taxable = subtotal.minus(discount);
  const tax = dec(money(taxable.times(TAX_RATE)));
  return {
    monthly: money(monthly),
    subtotal: money(subtotal),
    discount: money(discount),
    tax: money(tax),
    total: money(taxable.plus(tax)),
  };
}
