/**
 * Dates are stored in UTC and shown in the business time zone.
 * Default zone for the initial market (Mexico).
 */
export const DEFAULT_TIME_ZONE = "America/Mexico_City";

export function nowUtc(): Date {
  return new Date();
}

export function toIsoUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  return date.toISOString();
}

export function formatDateTime(
  date: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(
  date: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    dateStyle: "medium",
  }).format(date);
}
