import { describe, expect, it } from "vitest";

import {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_TRANSITIONS,
  canTransition,
  isPurchaseOrderStatus,
  transitionProblem,
} from "./order-states";

// CMP-05: draft → sent → partial → received, or cancelled; anything else
// is refused.

describe("states of a purchase order", () => {
  it("allows exactly the moves of the plan", () => {
    const allowed = PURCHASE_ORDER_STATUSES.flatMap((from) =>
      PURCHASE_ORDER_STATUSES.filter((to) => canTransition(from, to)).map(
        (to) => `${from} → ${to}`,
      ),
    );
    expect(allowed).toEqual([
      "DRAFT → SENT",
      "DRAFT → CANCELLED",
      "SENT → PARTIAL",
      "SENT → RECEIVED",
      "SENT → CANCELLED",
      "PARTIAL → RECEIVED",
    ]);
  });

  it("nothing leaves a final state, goes back, or stays where it is", () => {
    expect(PURCHASE_ORDER_TRANSITIONS.RECEIVED).toEqual([]);
    expect(PURCHASE_ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    for (const status of PURCHASE_ORDER_STATUSES) {
      expect(canTransition(status, status), status).toBe(false);
      if (status !== "DRAFT") {
        expect(canTransition(status, "DRAFT"), status).toBe(false);
      }
    }
    // Skipping the confirmation, or cancelling what already arrived.
    expect(canTransition("DRAFT", "PARTIAL")).toBe(false);
    expect(canTransition("DRAFT", "RECEIVED")).toBe(false);
    expect(canTransition("PARTIAL", "CANCELLED")).toBe(false);
    expect(canTransition("PARTIAL", "SENT")).toBe(false);
  });

  it("every refusal has a reason for people; every allowed move has none", () => {
    for (const from of PURCHASE_ORDER_STATUSES) {
      for (const to of PURCHASE_ORDER_STATUSES) {
        const problem = transitionProblem(from, to);
        if (canTransition(from, to))
          expect(problem, `${from}→${to}`).toBeNull();
        else expect(problem, `${from}→${to}`).toMatch(/\.$/);
      }
    }
    expect(transitionProblem("SENT", "SENT")).toBe(
      "Esta orden ya está enviada.",
    );
    expect(transitionProblem("PARTIAL", "CANCELLED")).toContain(
      "no se cancela",
    );
    expect(transitionProblem("CANCELLED", "SENT")).toContain("cancelada");
    expect(transitionProblem("SENT", "DRAFT")).toContain(
      "no vuelve a ser borrador",
    );
  });

  it("knows its own names", () => {
    expect(isPurchaseOrderStatus("PARTIAL")).toBe(true);
    expect(isPurchaseOrderStatus("partial")).toBe(false);
    expect(isPurchaseOrderStatus(undefined)).toBe(false);
  });
});
