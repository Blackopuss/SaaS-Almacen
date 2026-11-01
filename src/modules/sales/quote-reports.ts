import "server-only";

import { Decimal, dec } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

import { companyToday, dayOfDate } from "./calendar";
import { deliveredByLine } from "./order-fulfillment";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";
import { reportPeriod } from "./reports";
import { saleTotals } from "./tax";

/**
 * Reports of quotes (COT-11): how many quotes of a period became sales
 * (conversion) and what is pending today — quotes waiting for an answer and
 * orders with something to deliver. Worked out each time; nothing is
 * stored. Amounts are totals with VAT, as the customer sees them.
 */

/** Quotes a report reads at most (as the sales report). */
export const QUOTE_REPORT_MAX = 5_000;

export type QuoteTally = { count: number; total: string };

export type QuoteReport =
  | {
      ok: true;
      from: string;
      to: string;
      /** Quotes made in the period, whatever became of them. */
      made: QuoteTally;
      /** Of those, still drafts: they never left. */
      drafts: QuoteTally;
      /** Of those, the ones the customer received. */
      sent: QuoteTally;
      accepted: QuoteTally;
      rejected: QuoteTally;
      /** Sent and their last day passed without an answer. */
      expired: QuoteTally;
      /** Sent, still valid, waiting for an answer. */
      waiting: QuoteTally;
      /** «40 %» of the sent ones accepted; null when none was sent. */
      conversion: string | null;
      /** The same by amount. */
      conversionByAmount: string | null;
      /** Today, whatever the period: quotes waiting for an answer. */
      pendingQuotes: QuoteTally;
      /** Today: orders with something still to deliver, and its amount. */
      pendingOrders: QuoteTally;
      /** More quotes than the report reads: totals are incomplete. */
      truncated: boolean;
    }
  | { ok: false; error: string };

type Rule = { pricesIncludeTax: boolean; taxRate: { toString(): string } };

const totalOf = (amounts: readonly Decimal[], rule: Rule) =>
  saleTotals(amounts, {
    pricesIncludeTax: rule.pricesIncludeTax,
    rate: rule.taxRate.toString(),
  }).total;

const percent = (part: Decimal, whole: Decimal) =>
  whole.isZero()
    ? null
    : `${part
        .times(100)
        .dividedBy(whole)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toString()} %`;

class Tally {
  count = 0;
  total = dec(0);
  add(total: Decimal) {
    this.count += 1;
    this.total = this.total.plus(total);
  }
  get value(): QuoteTally {
    return { count: this.count, total: formatMoney(this.total) };
  }
}

export async function getQuoteReport(
  actor: SalesActor,
  range: { from?: string; to?: string } = {},
): Promise<QuoteReport> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.report.read");
  await assertModulePermission(organizationId, userId, "sales.quote.read");
  const period = await reportPeriod(organizationId, range);
  if (!period.ok) return period;
  const today = await companyToday(organizationId);
  const client = forOrganization(organizationId);

  const quotes = await client.salesQuote.findMany({
    where: { createdAt: { gte: period.start, lt: period.end } },
    orderBy: { number: "asc" },
    take: QUOTE_REPORT_MAX + 1,
    select: {
      status: true,
      validUntil: true,
      pricesIncludeTax: true,
      taxRate: true,
      lines: { select: { amount: true } },
    },
  });
  const truncated = quotes.length > QUOTE_REPORT_MAX;
  const made = new Tally();
  const tallies = {
    DRAFT: new Tally(),
    ACCEPTED: new Tally(),
    REJECTED: new Tally(),
    EXPIRED: new Tally(),
    WAITING: new Tally(),
  };
  const sent = new Tally();
  for (const quote of quotes.slice(0, QUOTE_REPORT_MAX)) {
    const total = totalOf(
      quote.lines.map((line) => dec(line.amount.toString())),
      quote,
    );
    made.add(total);
    if (quote.status === "DRAFT") {
      tallies.DRAFT.add(total);
      continue;
    }
    sent.add(total);
    if (quote.status === "SENT") {
      const expired = dayOfDate(quote.validUntil) < today;
      tallies[expired ? "EXPIRED" : "WAITING"].add(total);
    } else {
      tallies[quote.status].add(total);
    }
  }

  // Pending today, whatever the period.
  const waitingNow = await client.salesQuote.findMany({
    where: {
      status: "SENT",
      validUntil: { gte: new Date(`${today}T00:00:00.000Z`) },
    },
    take: QUOTE_REPORT_MAX,
    select: {
      pricesIncludeTax: true,
      taxRate: true,
      lines: { select: { amount: true } },
    },
  });
  const pendingQuotes = new Tally();
  for (const quote of waitingNow) {
    pendingQuotes.add(
      totalOf(
        quote.lines.map((line) => dec(line.amount.toString())),
        quote,
      ),
    );
  }
  const openOrders = await client.salesOrder.findMany({
    where: { status: { in: ["OPEN", "PARTIAL"] } },
    take: QUOTE_REPORT_MAX,
    select: {
      pricesIncludeTax: true,
      taxRate: true,
      discountPercent: true,
      lines: {
        select: {
          id: true,
          capturedQuantity: true,
          unitPrice: true,
          amount: true,
          discount: true,
        },
      },
    },
  });
  const delivered = await deliveredByLine(
    client,
    openOrders.flatMap((order) => order.lines.map((line) => line.id)),
  );
  const pendingOrders = new Tally();
  for (const order of openOrders) {
    // What is missing of each line, at its agreed amount after discount.
    const missing = order.lines.map((line) => {
      const ordered = dec(line.capturedQuantity.toString());
      const left = ordered.minus(delivered.get(line.id) ?? 0);
      return dec(line.amount.toString())
        .times(left)
        .dividedBy(ordered)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    });
    pendingOrders.add(totalOf(missing, order));
  }

  return {
    ok: true,
    from: period.from,
    to: period.to,
    made: made.value,
    drafts: tallies.DRAFT.value,
    sent: sent.value,
    accepted: tallies.ACCEPTED.value,
    rejected: tallies.REJECTED.value,
    expired: tallies.EXPIRED.value,
    waiting: tallies.WAITING.value,
    conversion: percent(dec(tallies.ACCEPTED.count), dec(sent.count)),
    conversionByAmount: percent(tallies.ACCEPTED.total, sent.total),
    pendingQuotes: pendingQuotes.value,
    pendingOrders: pendingOrders.value,
    truncated,
  };
}
