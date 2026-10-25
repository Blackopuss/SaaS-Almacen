/**
 * Plan validity moved by manual payments (PIL-11). Pure: no database.
 *
 * The plan ends at the end of a calendar day in central Mexico (UTC-6, no
 * daylight saving), the same convention as the provisioning form. Months
 * are calendar months; a day that does not exist in the target month is
 * clamped to its last day (31 Jan + 1 month = 28/29 Feb).
 */

const MEXICO_OFFSET_MS = 6 * 3_600_000;

/** Calendar day (UTC midnight of that date) of an instant, in central Mexico. */
export function mexicoDay(at: Date): Date {
  const local = new Date(at.getTime() - MEXICO_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
}

/** Last millisecond of a calendar day (UTC midnight of that date) in central Mexico. */
export function endOfMexicoDay(day: Date): Date {
  return new Date(day.getTime() + 86_400_000 - 1 + MEXICO_OFFSET_MS);
}

function addMonths(day: Date, months: number): Date {
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth() + months;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day.getUTCDate(), last)));
}

/**
 * New end of the plan after paying `months`: from its current end, or from
 * today when it already ended (the days without plan are not charged).
 */
export function extendValidity(
  currentEnd: Date,
  now: Date,
  months: number,
): Date {
  const from = currentEnd > now ? currentEnd : now;
  return endOfMexicoDay(addMonths(mexicoDay(from), months));
}

/**
 * End of the plan after taking back `months` (a reversed payment). When
 * nothing moved the plan after that payment, `previousEnd` (where it was
 * before the payment) is restored exactly; otherwise the months are taken
 * from the current end. It never goes back past now (rights already used
 * are not undone) and never moves a plan that already ended.
 */
export function shortenValidity(
  currentEnd: Date,
  now: Date,
  months: number,
  previousEnd: Date | null = null,
): Date {
  const shortened =
    previousEnd ?? endOfMexicoDay(addMonths(mexicoDay(currentEnd), -months));
  const floor = currentEnd < now ? currentEnd : now;
  return shortened > floor ? shortened : floor;
}
