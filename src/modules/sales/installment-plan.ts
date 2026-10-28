import { Decimal, dec, type DecimalInput } from "@/lib";

/**
 * The payment calendar of a sale on installments (PAG-02, ADR 0030). Pure:
 * no database.
 *
 *   financed  = total − down payment
 *   interest  = financed × interest % (once, in cents, half up)
 *   each      = (financed + interest) ÷ months, cut to cents
 *   last      = the rest, so the payments add up exactly
 *
 * Payments fall due month by month from the day of the sale, on the same
 * day of the month or the last day of shorter months (Jan 31 → Feb 28).
 */

export type InstallmentPlanInput = {
  /** What the sale adds up to, VAT included: «10000.00». */
  total: DecimalInput;
  downPayment: DecimalInput;
  months: number;
  /** «10.00»; «0» = no interest. */
  interestPercent: DecimalInput;
  /** The day of the sale in the company's calendar: «2026-10-28». */
  startDay: string;
};

export type InstallmentPlan = {
  downPayment: Decimal;
  financed: Decimal;
  interest: Decimal;
  /** Down payment + financed + interest. */
  totalToPay: Decimal;
  installments: { number: number; dueDay: string; amount: Decimal }[];
};

export type InstallmentPlanResult =
  { ok: true; plan: InstallmentPlan } | { ok: false; error: string };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The same day so many months later, or the month's last day. */
export function addMonths(day: string, months: number): string {
  const match = DAY.exec(day);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]) - 1 + months;
  const wanted = Number(match[3]);
  const target = new Date(Date.UTC(year, month, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(wanted, last));
  return target.toISOString().slice(0, 10);
}

export function planInstallments(
  input: InstallmentPlanInput,
): InstallmentPlanResult {
  const total = dec(input.total);
  const down = dec(input.downPayment);
  const rate = dec(input.interestPercent);
  if (!Number.isInteger(input.months) || input.months < 1) {
    return { ok: false, error: "El plazo debe ser de al menos un mes." };
  }
  if (
    !DAY.test(input.startDay) ||
    addMonths(input.startDay, 0) !== input.startDay
  ) {
    return { ok: false, error: "La fecha de la venta no es válida." };
  }
  if (down.isNegative() || down.decimalPlaces() > 2) {
    return { ok: false, error: "Escribe el enganche en pesos y centavos." };
  }
  if (!down.lessThan(total)) {
    return {
      ok: false,
      error: "El enganche cubre todo: cóbrala de contado.",
    };
  }
  if (rate.isNegative() || rate.greaterThan(100)) {
    return { ok: false, error: "El interés debe ser del 0 al 100 %." };
  }
  const financed = total.minus(down);
  const interest = financed
    .times(rate)
    .dividedBy(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const owed = financed.plus(interest);
  const each = owed
    .dividedBy(input.months)
    .toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const installments = Array.from({ length: input.months }, (_, index) => ({
    number: index + 1,
    dueDay: addMonths(input.startDay, index + 1),
    amount:
      index === input.months - 1
        ? owed.minus(each.times(input.months - 1))
        : each,
  }));
  return {
    ok: true,
    plan: {
      downPayment: down,
      financed,
      interest,
      totalToPay: down.plus(owed),
      installments,
    },
  };
}
