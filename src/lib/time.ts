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

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 60 * 60],
  ["day", 60 * 60 * 24],
  ["week", 60 * 60 * 24 * 7],
];

/** "Ahora", "hace 5 minutos", "hace 2 días" (Spanish, Mexico). */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 60) return "Ahora";
  const format = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [u, s] of RELATIVE_STEPS) {
    if (Math.abs(seconds) >= s) {
      unit = u;
      size = s;
    }
  }
  return format.format(Math.round(seconds / size), unit);
}
