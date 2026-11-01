import "server-only";

import { forOrganization } from "@/server";

/**
 * Days of the company's calendar (its time zone): what «today» is for a
 * report or a quote's validity, written «2026-10-15».
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** «2026-10-15» of a moment, in the calendar of a time zone. */
export function dayOf(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
}

/** The day so many days after; "" when `day` is not a day. */
export function addDays(day: string, days: number): string {
  if (!DAY.test(day)) return "";
  const date = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whether the text is a real day of the calendar («2026-02-30» is not). */
export const isDay = (text: string) =>
  DAY.test(text) && addDays(text, 0) === text;

export async function timeZoneOf(organizationId: string): Promise<string> {
  const company = await forOrganization(organizationId).membership.findFirst({
    select: { organization: { select: { timeZone: true } } },
  });
  return company?.organization.timeZone || "America/Mexico_City";
}

let clock = () => Date.now();

/** Now, for what depends on the day (what is overdue, PAG-07). */
export const salesNow = () => new Date(clock());

/** For tests: moves «now» of Ventas; returns how to put it back. */
export function setSalesClock(next: () => number): () => void {
  const previous = clock;
  clock = next;
  return () => {
    clock = previous;
  };
}

/** Today in the company's calendar. */
export async function companyToday(organizationId: string): Promise<string> {
  return dayOf(salesNow(), await timeZoneOf(organizationId));
}

/** A `DATE` column as it is stored: the day at 00:00 UTC. */
export const dateOfDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** «2026-10-15» of a `DATE` column. */
export const dayOfDate = (date: Date) => date.toISOString().slice(0, 10);
