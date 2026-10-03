import "server-only";

import { createHash } from "node:crypto";

import { db } from "@/server";

/**
 * Brute-force protection (PLT-06). Fixed-window counters in MySQL, updated
 * with one atomic statement per attempt so concurrent requests cannot skip
 * the count. All times use the database clock (UTC_TIMESTAMP).
 *
 * Emails are stored only as SHA-256 hashes. Failures are counted for the
 * submitted email whether or not an account exists, so being blocked never
 * reveals which accounts exist.
 */
export type ThrottleRule = {
  /** Attempts allowed within the window before blocking. */
  max: number;
  windowSeconds: number;
  blockSeconds: number;
};

export const RULES = {
  signInAccount: { max: 5, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  // Higher: several employees often share one shop connection.
  signInIp: { max: 20, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  registerIp: { max: 10, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
  resendEmail: { max: 3, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
  resendIp: { max: 10, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
} as const satisfies Record<string, ThrottleRule>;

export type ThrottleKey = { key: string; rule: ThrottleRule };

const hash = (value: string) =>
  createHash("sha256").update(value.trim().toLowerCase()).digest("hex");

export const throttleKeys = {
  signInAccount: (email: string): ThrottleKey => ({
    key: `signin:acct:${hash(email)}`,
    rule: RULES.signInAccount,
  }),
  signInIp: (ip: string): ThrottleKey => ({
    key: `signin:ip:${ip}`,
    rule: RULES.signInIp,
  }),
  registerIp: (ip: string): ThrottleKey => ({
    key: `register:ip:${ip}`,
    rule: RULES.registerIp,
  }),
  resendEmail: (email: string): ThrottleKey => ({
    key: `resend:email:${hash(email)}`,
    rule: RULES.resendEmail,
  }),
  resendIp: (ip: string): ThrottleKey => ({
    key: `resend:ip:${ip}`,
    rule: RULES.resendIp,
  }),
};

/**
 * Client IP as seen by the app. In production the app must sit behind a
 * proxy that overwrites X-Forwarded-For (documented in ADR 0003).
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 64);
}

/** Seconds until all given keys are unblocked; 0 when none is blocked. */
export async function blockedFor(keys: ThrottleKey[]): Promise<number> {
  if (keys.length === 0) return 0;
  const rows = await db.$queryRawUnsafe<{ wait: bigint | number | null }[]>(
    `SELECT MAX(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), blockedUntil)) AS wait
       FROM auth_throttle
      WHERE \`key\` IN (${keys.map(() => "?").join(", ")})
        AND blockedUntil > UTC_TIMESTAMP(3)`,
    ...keys.map((k) => k.key),
  );
  return Math.max(0, Number(rows[0]?.wait ?? 0));
}

/** Counts one attempt for each key; blocks the key when it reaches max. */
export async function recordAttempt(keys: ThrottleKey[]): Promise<void> {
  for (const { key, rule } of keys) {
    // Assignments run left to right: `count` is updated first and the
    // block check below sees the new value (MySQL semantics).
    await db.$executeRawUnsafe(
      `INSERT INTO auth_throttle (\`key\`, count, windowStart, blockedUntil)
       VALUES (?, 1, UTC_TIMESTAMP(3), IF(1 >= ?, UTC_TIMESTAMP(3) + INTERVAL ? SECOND, NULL))
       ON DUPLICATE KEY UPDATE
         count = IF(windowStart < UTC_TIMESTAMP(3) - INTERVAL ? SECOND, 1, count + 1),
         windowStart = IF(windowStart < UTC_TIMESTAMP(3) - INTERVAL ? SECOND, UTC_TIMESTAMP(3), windowStart),
         blockedUntil = IF(count >= ?, UTC_TIMESTAMP(3) + INTERVAL ? SECOND, blockedUntil)`,
      key,
      rule.max,
      rule.blockSeconds,
      rule.windowSeconds,
      rule.windowSeconds,
      rule.max,
      rule.blockSeconds,
    );
  }
}

/** Clears counters (e.g. the account after a successful sign-in). */
export async function clearAttempts(keys: ThrottleKey[]): Promise<void> {
  if (keys.length === 0) return;
  await db.authThrottle.deleteMany({
    where: { key: { in: keys.map((k) => k.key) } },
  });
}

/** Spanish message for a blocked action. */
export function tooManyAttemptsMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Demasiados intentos. Espera ${minutes} ${minutes === 1 ? "minuto" : "minutos"} e inténtalo de nuevo.`;
}
