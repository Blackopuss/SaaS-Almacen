/**
 * States of a sales order and the moves between them (COT-07). Pure: the
 * one table services, screens and the database trigger agree on.
 *
 *   Por surtir ──▶ Surtido en parte ──▶ Surtido
 *        │                 │
 *        └─────────────────┴──────────▶ Cancelado
 *
 * - Each delivery is a sale: the order is «Surtido en parte» while
 *   something is missing and «Surtido» when nothing is.
 * - Cancelling (COT-09) closes what is missing; what was delivered stays
 *   sold and comes back, if it does, as a return of its sale.
 * - Surtido and Cancelado are final.
 */

export type SalesOrderStatus = "OPEN" | "PARTIAL" | "FULFILLED" | "CANCELLED";

export const SALES_ORDER_TRANSITIONS: Record<
  SalesOrderStatus,
  readonly SalesOrderStatus[]
> = {
  OPEN: ["PARTIAL", "FULFILLED", "CANCELLED"],
  PARTIAL: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  CANCELLED: [],
};

export const canSalesOrderTransition = (
  from: SalesOrderStatus,
  to: SalesOrderStatus,
): boolean => SALES_ORDER_TRANSITIONS[from].includes(to);

/** Whether something of it may still be delivered. */
export const awaitsFulfillment = (status: SalesOrderStatus): boolean =>
  status === "OPEN" || status === "PARTIAL";
