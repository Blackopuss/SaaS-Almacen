/**
 * Audit metadata never stores secrets (PLT-14): keys that look like
 * passwords, tokens, codes, secrets, cookies or keys are dropped, long
 * strings are cut, and depth and size are capped so a log entry cannot be
 * used to dump data.
 */

const SECRET_KEY =
  /pass(word)?|token|secret|cookie|authorization|otp|totp|code|key|hash/i;
const MAX_STRING = 200;
const MAX_ITEMS = 50;
const MAX_DEPTH = 4;

export type AuditMetadata = Record<string, unknown>;

/** JSON that is safe to store (matches Prisma's JSON input). */
export type SafeJson = string | number | boolean | SafeJson[] | SafeJsonObject;
export type SafeJsonObject = { [key: string]: SafeJson | null };

function clean(value: unknown, depth: number): SafeJson | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ITEMS)
      .map((item) => clean(item, depth + 1))
      .filter((item): item is SafeJson => item !== null);
  }
  if (typeof value === "object") {
    const out: SafeJsonObject = {};
    for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = clean(item, depth + 1);
    }
    return out;
  }
  return null; // functions, symbols
}

/** Safe copy of the metadata, or null when nothing is left. */
export function sanitizeMetadata(
  metadata: AuditMetadata | undefined,
): SafeJsonObject | null {
  if (!metadata) return null;
  const result = clean(metadata, 0) as SafeJsonObject;
  return Object.keys(result).length > 0 ? result : null;
}
