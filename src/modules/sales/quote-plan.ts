import "server-only";

import { Decimal, dec } from "@/lib";
import type { TenantDb } from "@/server";

import { formatPercent } from "./discounts";
import { planInstallments, type InstallmentPlan } from "./installment-plan";
import { readInstallmentTerms } from "./installment-terms";
import { formatMoney, parsePrice } from "./pricing";

/**
 * The payment plan a quote offers (PAG-03, ADR 0030): cash, or one of the
 * company's terms with a down payment that covers at least the cost of the
 * goods (average cost × quantity). The minimum is told only to who may see
 * costs; the rest learn that it falls short.
 */

type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export type QuotePlanInput = {
  /** «6»; empty = cash. */
  months?: string;
  /** As typed: «2,000». */
  downPayment?: string;
};

export type StoredPlan = {
  installmentMonths: number;
  installmentInterestPercent: string;
  downPayment: string;
};

export type QuotePlanCheck =
  | { ok: true; stored: StoredPlan | null; plan: InstallmentPlan | null }
  | {
      ok: false;
      field: "planMonths" | "planDownPayment";
      error: string;
      /** «$1,234.50»: only for who may see costs. */
      minimum?: string;
    };

/** What the goods cost: average cost × base quantity, up to the cent. */
export async function minimumDownPayment(
  client: Client,
  lines: readonly { productId: string; baseQuantity: Decimal }[],
): Promise<Decimal> {
  const costs = new Map(
    (
      await client.productCost.findMany({
        where: {
          productId: { in: [...new Set(lines.map((l) => l.productId))] },
        },
        select: { productId: true, averageCost: true },
      })
    ).map((row) => [row.productId, dec(row.averageCost.toString())]),
  );
  // A product without a known cost adds nothing: there is nothing to cover.
  return lines
    .reduce(
      (sum, line) =>
        sum.plus(
          (costs.get(line.productId) ?? dec(0)).times(line.baseQuantity),
        ),
      dec(0),
    )
    .toDecimalPlaces(2, Decimal.ROUND_UP);
}

/**
 * Checks the plan of a quote against the company's terms and the cost of
 * its goods. `total` is what the quote adds up to, VAT included.
 */
export async function checkQuotePlan(
  client: Client,
  input: {
    plan: QuotePlanInput | undefined;
    lines: readonly { productId: string; baseQuantity: Decimal }[];
    total: Decimal;
    /** The day the calendar would start: today. */
    today: string;
    mayReadCosts: boolean;
  },
): Promise<QuotePlanCheck> {
  const months = String(input.plan?.months ?? "").trim();
  if (months === "") return { ok: true, stored: null, plan: null };
  const term = (await readInstallmentTerms(client)).find(
    (row) => String(row.months) === months,
  );
  if (!term) {
    return {
      ok: false,
      field: "planMonths",
      error: "Ese plazo ya no se ofrece. Elige otro.",
    };
  }
  const typedDown = String(input.plan?.downPayment ?? "").trim();
  const down = typedDown === "" ? "0.00" : parsePrice(typedDown);
  if (down === null) {
    return {
      ok: false,
      field: "planDownPayment",
      error: "Escribe el enganche como 1,500 o 1500.50.",
    };
  }
  const minimum = await minimumDownPayment(client, input.lines);
  if (dec(down).lessThan(minimum)) {
    return input.mayReadCosts
      ? {
          ok: false,
          field: "planDownPayment",
          error: `El enganche debe cubrir el costo de la mercancía: al menos ${formatMoney(minimum)}.`,
          minimum: formatMoney(minimum),
        }
      : {
          ok: false,
          field: "planDownPayment",
          error:
            "El enganche no alcanza a cubrir el costo de la mercancía: súbelo.",
        };
  }
  const result = planInstallments({
    total: input.total,
    downPayment: down,
    months: term.months,
    interestPercent: term.interestPercent,
    startDay: input.today,
  });
  if (!result.ok) {
    return { ok: false, field: "planDownPayment", error: result.error };
  }
  return {
    ok: true,
    stored: {
      installmentMonths: term.months,
      installmentInterestPercent: term.interestPercent,
      downPayment: down,
    },
    plan: result.plan,
  };
}

export type QuotePlanView = {
  months: number;
  /** «sin interés», «10 % de interés». */
  interestText: string;
  downPayment: string;
  financed: string;
  interest: string;
  totalToPay: string;
  /** «$1,466.66». */
  installment: string;
  /** Only when the last one differs: «$1,466.70». */
  lastInstallment: string | null;
};

/** How a plan reads on screen and on paper. */
export function planView(
  plan: InstallmentPlan,
  months: number,
  interestPercent: string,
): QuotePlanView {
  const first = plan.installments[0]!.amount;
  const last = plan.installments.at(-1)!.amount;
  return {
    months,
    interestText: dec(interestPercent).isZero()
      ? "sin interés"
      : `${formatPercent(interestPercent)} de interés`,
    downPayment: formatMoney(plan.downPayment),
    financed: formatMoney(plan.financed),
    interest: formatMoney(plan.interest),
    totalToPay: formatMoney(plan.totalToPay),
    installment: formatMoney(first),
    lastInstallment: last.equals(first) ? null : formatMoney(last),
  };
}

/** The view of a stored plan, from the quote's own total. */
export function storedPlanView(
  stored: {
    installmentMonths: number | null;
    installmentInterestPercent: { toString(): string } | null;
    downPayment: { toString(): string } | null;
  },
  total: Decimal,
  today: string,
): QuotePlanView | null {
  if (
    stored.installmentMonths === null ||
    stored.installmentInterestPercent === null ||
    stored.downPayment === null
  ) {
    return null;
  }
  const result = planInstallments({
    total,
    downPayment: stored.downPayment.toString(),
    months: stored.installmentMonths,
    interestPercent: stored.installmentInterestPercent.toString(),
    startDay: today,
  });
  return result.ok
    ? planView(
        result.plan,
        stored.installmentMonths,
        stored.installmentInterestPercent.toString(),
      )
    : null;
}
