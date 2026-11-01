import { describe, expect, it } from "vitest";

import {
  QUOTE_TRANSITIONS,
  canQuoteTransition,
  quoteTransitionProblem,
  type StoredQuoteStatus,
} from "./quote-states";

const ALL: StoredQuoteStatus[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED"];

describe("quote transitions (COT-04)", () => {
  it("draft → sent → accepted or rejected, and nothing else", () => {
    const allowed = ALL.flatMap((from) =>
      ALL.filter((to) => canQuoteTransition(from, to)).map(
        (to) => `${from}→${to}`,
      ),
    );
    expect(allowed).toEqual(["DRAFT→SENT", "SENT→ACCEPTED", "SENT→REJECTED"]);
    expect(QUOTE_TRANSITIONS.ACCEPTED).toEqual([]);
    expect(QUOTE_TRANSITIONS.REJECTED).toEqual([]);
  });

  it("says why, in words for people", () => {
    expect(quoteTransitionProblem("SENT", "ACCEPTED", false)).toBeNull();
    expect(quoteTransitionProblem("SENT", "ACCEPTED", true)).toMatch(/venció/);
    // An expired quote may still be rejected.
    expect(quoteTransitionProblem("SENT", "REJECTED", true)).toBeNull();
    expect(quoteTransitionProblem("DRAFT", "ACCEPTED", false)).toMatch(
      /Primero envía/,
    );
    expect(quoteTransitionProblem("DRAFT", "SENT", true)).toMatch(/vigencia/);
    expect(quoteTransitionProblem("ACCEPTED", "REJECTED", false)).toMatch(
      /ya se aceptó/,
    );
    expect(quoteTransitionProblem("REJECTED", "ACCEPTED", false)).toMatch(
      /ya se rechazó/,
    );
    expect(quoteTransitionProblem("SENT", "DRAFT", false)).toMatch(
      /no vuelve a borrador/,
    );
    // Already there: not a problem, the service answers «repeated».
    expect(quoteTransitionProblem("SENT", "SENT", false)).toBeNull();
  });
});
