import { describe, expect, it } from "vitest";

import {
  endOfMexicoDay,
  extendValidity,
  renewalDaysLeft,
  renewalText,
  shortenValidity,
} from "./validity";

// PIL-11: a payment moves the end of the plan by calendar months, at the
// end of the day in central Mexico.

const end = (day: string) => endOfMexicoDay(new Date(`${day}T00:00:00Z`));

describe("plan validity", () => {
  it("ends at the last millisecond of the day in central Mexico", () => {
    expect(end("2026-10-31").toISOString()).toBe("2026-11-01T05:59:59.999Z");
  });

  it("extends from the current end while the plan is in force", () => {
    const now = new Date("2026-10-25T18:00:00Z");
    expect(extendValidity(end("2026-10-31"), now, 1)).toEqual(
      end("2026-11-30"),
    );
    expect(extendValidity(end("2026-11-15"), now, 3)).toEqual(
      end("2027-02-15"),
    );
  });

  it("extends from today when the plan already ended", () => {
    // 25 Oct 02:00 UTC is still 24 Oct in Mexico.
    const now = new Date("2026-10-25T02:00:00Z");
    expect(extendValidity(end("2026-09-30"), now, 1)).toEqual(
      end("2026-11-24"),
    );
  });

  it("clamps to the last day of shorter months", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(extendValidity(end("2026-01-31"), now, 1)).toEqual(
      end("2026-02-28"),
    );
    expect(extendValidity(end("2027-12-31"), now, 2)).toEqual(
      end("2028-02-29"),
    );
  });

  it("a reversal takes the same months back, never past now", () => {
    const now = new Date("2026-10-25T18:00:00Z");
    expect(shortenValidity(end("2026-12-31"), now, 1)).toEqual(
      end("2026-11-30"),
    );
    expect(shortenValidity(end("2027-02-15"), now, 3)).toEqual(
      end("2026-11-15"),
    );
    expect(shortenValidity(end("2026-11-10"), now, 1)).toEqual(now);
    // The last payment is undone exactly, even after a clamped month.
    expect(
      shortenValidity(end("2027-02-28"), now, 3, end("2026-11-30")),
    ).toEqual(end("2026-11-30"));
    // A plan that already ended stays where it was.
    expect(shortenValidity(end("2026-09-30"), now, 1)).toEqual(
      end("2026-09-30"),
    );
  });
});

describe("renewal warning", () => {
  const now = new Date("2026-11-01T18:00:00Z");

  it("warns in the last 15 calendar days, not before nor after the end", () => {
    expect(renewalDaysLeft(end("2026-11-01"), now)).toBe(0);
    expect(renewalDaysLeft(end("2026-11-02"), now)).toBe(1);
    expect(renewalDaysLeft(end("2026-11-16"), now)).toBe(15);
    expect(renewalDaysLeft(end("2026-11-17"), now)).toBeNull();
    expect(renewalDaysLeft(end("2026-10-31"), now)).toBeNull();
    expect(renewalDaysLeft(null, now)).toBeNull();
  });

  it("says when, in words", () => {
    expect(renewalText(0, end("2026-11-01"))).toMatch(/^Tu plan vence hoy\./);
    expect(renewalText(1, end("2026-11-02"))).toContain("mañana (2 nov 2026)");
    expect(renewalText(5, end("2026-11-06"))).toContain(
      "en 5 días (el 6 nov 2026)",
    );
  });
});
