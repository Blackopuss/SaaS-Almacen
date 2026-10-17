import { randomInt } from "node:crypto";

/**
 * MFA backup codes (PLT-09). Ten single-use codes like "k7m2p-9xq4t":
 * lowercase letters and digits without look-alikes (0/o, 1/l/i), so they
 * are easy to read from paper and type on a phone. Better Auth compares
 * them exactly, so input goes through `normalizeBackupCode` first.
 */
export const BACKUP_CODE_COUNT = 10;

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const HALF = 5;

export function generateBackupCodes(): string[] {
  const half = () =>
    Array.from(
      { length: HALF },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join("");
  return Array.from({ length: BACKUP_CODE_COUNT }, () => `${half()}-${half()}`);
}

/** "K7M2P 9XQ4T", "k7m2p9xq4t" → "k7m2p-9xq4t"; null if it cannot be one. */
export function normalizeBackupCode(value: string): string | null {
  const compact = value.toLowerCase().replace(/[\s-]/g, "");
  if (compact.length !== HALF * 2) return null;
  if ([...compact].some((char) => !ALPHABET.includes(char))) return null;
  return `${compact.slice(0, HALF)}-${compact.slice(HALF)}`;
}
