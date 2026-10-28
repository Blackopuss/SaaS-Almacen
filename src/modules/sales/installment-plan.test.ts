import { describe, expect, it } from "vitest";

import { dec } from "@/lib";

import { addMonths, planInstallments } from "./installment-plan";

const amounts = (result: ReturnType<typeof planInstallments>) =>
  result.ok
    ? result.plan.installments.map((i) => [i.dueDay, i.amount.toFixed(2)])
    : result.error;

describe("payment calendar", () => {
  it("without interest: the rounding falls on the last payment", () => {
    const result = planInstallments({
      total: "1000",
      downPayment: "300",
      months: 3,
      interestPercent: "0",
      startDay: "2026-10-28",
    });
    expect(result.ok && result.plan.interest.toFixed(2)).toBe("0.00");
    // 700 ÷ 3 = 233.33…; the last carries the cent.
    expect(amounts(result)).toEqual([
      ["2026-11-28", "233.33"],
      ["2026-12-28", "233.33"],
      ["2027-01-28", "233.34"],
    ]);
  });

  it("with interest: added once to what is financed", () => {
    const result = planInstallments({
      total: "10000",
      downPayment: "2000",
      months: 6,
      interestPercent: "10",
      startDay: "2026-10-28",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.financed.toFixed(2)).toBe("8000.00");
    expect(result.plan.interest.toFixed(2)).toBe("800.00");
    expect(result.plan.totalToPay.toFixed(2)).toBe("10800.00");
    // 8,800 ÷ 6 = 1,466.666…
    expect(amounts(result)).toEqual([
      ["2026-11-28", "1466.66"],
      ["2026-12-28", "1466.66"],
      ["2027-01-28", "1466.66"],
      ["2027-02-28", "1466.66"],
      ["2027-03-28", "1466.66"],
      ["2027-04-28", "1466.70"],
    ]);
  });

  it("the payments always add up exactly", () => {
    for (const months of [1, 5, 7, 12, 24, 60]) {
      for (const rate of ["0", "7.5", "33.33"]) {
        const result = planInstallments({
          total: "12345.67",
          downPayment: "1234.56",
          months,
          interestPercent: rate,
          startDay: "2026-01-31",
        });
        if (!result.ok) throw new Error(result.error);
        const sum = result.plan.installments.reduce(
          (total, i) => total.plus(i.amount),
          dec(0),
        );
        expect(sum.plus(result.plan.downPayment)).toEqual(
          result.plan.totalToPay,
        );
        const last = result.plan.installments.at(-1)!.amount;
        const first = result.plan.installments[0]!.amount;
        expect(last.minus(first).lessThan(dec(months).times("0.01"))).toBe(
          true,
        );
      }
    }
  });

  it("due days keep the day of the month, or the month's last", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
  });

  it("refuses what is not a plan", () => {
    const base = {
      total: "1000",
      downPayment: "100",
      months: 3,
      interestPercent: "0",
      startDay: "2026-10-28",
    };
    expect(planInstallments({ ...base, downPayment: "1000" })).toEqual({
      ok: false,
      error: "El enganche cubre todo: cóbrala de contado.",
    });
    expect(planInstallments({ ...base, downPayment: "-1" }).ok).toBe(false);
    expect(planInstallments({ ...base, downPayment: "10.005" }).ok).toBe(false);
    expect(planInstallments({ ...base, months: 0 }).ok).toBe(false);
    expect(planInstallments({ ...base, months: 2.5 }).ok).toBe(false);
    expect(planInstallments({ ...base, interestPercent: "101" }).ok).toBe(
      false,
    );
    expect(planInstallments({ ...base, startDay: "2026-02-30" }).ok).toBe(
      false,
    );
    // No down payment is a plan too.
    expect(planInstallments({ ...base, downPayment: "0" }).ok).toBe(true);
  });
});
