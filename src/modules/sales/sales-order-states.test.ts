import { describe, expect, it } from "vitest";

import {
  SALES_ORDER_TRANSITIONS,
  awaitsFulfillment,
  canSalesOrderTransition,
  type SalesOrderStatus,
} from "./sales-order-states";

const ALL: SalesOrderStatus[] = ["OPEN", "PARTIAL", "FULFILLED", "CANCELLED"];

describe("states of a sales order", () => {
  it("is the table the database trigger repeats", () => {
    // sales_order_update_rules: from OPEN or PARTIAL to PARTIAL,
    // FULFILLED or CANCELLED; nothing else moves.
    const moves = ALL.flatMap((from) =>
      ALL.filter((to) => to !== from && canSalesOrderTransition(from, to)).map(
        (to) => `${from}>${to}`,
      ),
    );
    expect(moves).toEqual([
      "OPEN>PARTIAL",
      "OPEN>FULFILLED",
      "OPEN>CANCELLED",
      "PARTIAL>FULFILLED",
      "PARTIAL>CANCELLED",
    ]);
  });

  it("fulfilled and cancelled are final", () => {
    expect(SALES_ORDER_TRANSITIONS.FULFILLED).toEqual([]);
    expect(SALES_ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    expect(ALL.filter(awaitsFulfillment)).toEqual(["OPEN", "PARTIAL"]);
  });
});
