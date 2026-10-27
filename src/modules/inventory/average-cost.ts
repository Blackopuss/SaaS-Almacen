import { Decimal, dec, type DecimalInput } from "@/lib";

/**
 * Average cost of a product (VAL-01, ADR 0031): SAP's moving average price,
 * kept as SAP keeps it — the value of all the product's stock and the price
 * per unit of the product. Pure: no database.
 *
 * - An entry with a cost adds quantity × cost to the value; the new price
 *   is value ÷ quantity. 10 at $85 + 10 at $95 → $90.
 * - An entry without a cost comes in at the current price, which does not
 *   change. A product with no known cost stays without one.
 * - The first known cost also values the stock that had none, so a product
 *   never carries a value for only part of its stock.
 * - An exit takes quantity × price out of the value and never moves the
 *   price. When nothing is left, the value goes to zero (the rounding
 *   residue disappears) and the price stays for the next entry.
 * - A return to the supplier (or the reversal of an entry) leaves at the
 *   cost it came in with (`valueExitAt`), so the price of what stays moves.
 *
 * Every amount is before taxes, per unit of the product, with six decimals.
 */

/** Decimals of prices and values. */
export const COST_SCALE = 6;

export type CostState = {
  /** Price of one unit of the product. */
  averageCost: Decimal;
  /** Value of all its stock: about quantity × averageCost. */
  stockValue: Decimal;
};

export type Valued = {
  /** State after the movement; null while the cost is unknown. */
  state: CostState | null;
  /** Cost per unit the line is valued at; null when unknown. */
  unitCost: Decimal | null;
};

const round = (value: Decimal) =>
  value.toDecimalPlaces(COST_SCALE, Decimal.ROUND_HALF_UP);

/**
 * An entry of `quantity` units when `onHand` units were in stock (all
 * locations together, read under the product's lock).
 */
export function valueEntry(
  state: CostState | null,
  onHand: DecimalInput,
  quantity: DecimalInput,
  unitCost: DecimalInput | null,
): Valued {
  const before = dec(onHand);
  const added = dec(quantity);
  assertMovement(before, added);
  const after = before.plus(added);

  if (unitCost === null) {
    if (!state) return { state: null, unitCost: null };
    return {
      state: {
        averageCost: state.averageCost,
        stockValue: round(
          state.stockValue.plus(added.times(state.averageCost)),
        ),
      },
      unitCost: state.averageCost,
    };
  }

  const cost = round(dec(unitCost));
  if (cost.isNegative()) throw new RangeError("A cost cannot be negative.");
  // Stock with no known cost takes the first one known.
  const valueBefore = state ? state.stockValue : before.times(cost);
  const stockValue = round(valueBefore.plus(added.times(cost)));
  return {
    state: {
      averageCost: after.isZero() ? cost : round(stockValue.dividedBy(after)),
      stockValue,
    },
    unitCost: cost,
  };
}

/** An exit of `quantity` units when `onHand` units were in stock. */
export function valueExit(
  state: CostState | null,
  onHand: DecimalInput,
  quantity: DecimalInput,
): Valued {
  const before = dec(onHand);
  const taken = dec(quantity);
  assertMovement(before, taken);
  if (taken.greaterThan(before)) {
    throw new RangeError("An exit cannot take more than the stock.");
  }
  if (!state) return { state: null, unitCost: null };
  const left = before.minus(taken);
  const stockValue = left.isZero()
    ? new Decimal(0)
    : Decimal.max(
        0,
        round(state.stockValue.minus(taken.times(state.averageCost))),
      );
  return {
    state: { averageCost: state.averageCost, stockValue },
    unitCost: state.averageCost,
  };
}

/**
 * An exit at the cost something entered with, not at the average: a return
 * to the supplier or the reversal of an entry takes back exactly what that
 * entry added, so the average of what stays can move. Without a cost (or
 * with no known cost yet) it is an ordinary exit.
 */
export function valueExitAt(
  state: CostState | null,
  onHand: DecimalInput,
  quantity: DecimalInput,
  unitCost: DecimalInput | null,
): Valued {
  if (unitCost === null || !state) return valueExit(state, onHand, quantity);
  const before = dec(onHand);
  const taken = dec(quantity);
  assertMovement(before, taken);
  if (taken.greaterThan(before)) {
    throw new RangeError("An exit cannot take more than the stock.");
  }
  const cost = round(dec(unitCost));
  if (cost.isNegative()) throw new RangeError("A cost cannot be negative.");
  const left = before.minus(taken);
  if (left.isZero()) {
    return {
      state: { averageCost: state.averageCost, stockValue: new Decimal(0) },
      unitCost: cost,
    };
  }
  const stockValue = Decimal.max(
    0,
    round(state.stockValue.minus(taken.times(cost))),
  );
  return {
    state: { averageCost: round(stockValue.dividedBy(left)), stockValue },
    unitCost: cost,
  };
}

function assertMovement(onHand: Decimal, quantity: Decimal) {
  if (onHand.isNegative()) throw new RangeError("Stock cannot be negative.");
  if (!quantity.isPositive() || quantity.isZero()) {
    throw new RangeError("A movement moves a positive quantity.");
  }
}
