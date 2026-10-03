import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Password policy and hashing (PLT-02).
 *
 * Policy (OWASP ASVS 2.1): 12 to 128 characters, every character allowed,
 * no composition rules. Hash: scrypt with an OWASP-recommended setting
 * (N=2^15, r=8, p=3; 32 MiB per hash). Parameters are stored with each hash
 * so they can be raised later without breaking existing passwords.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const PREFIX = "scrypt";

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

const memoryFor = (N: number, r: number) => 128 * N * r * 2;

/** Normalizes so the same visible password always hashes the same way. */
const normalize = (password: string) => password.normalize("NFKC");

/** Format: scrypt$N$r$p$saltBase64$hashBase64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p } = PARAMS;
  const key = await scrypt(normalize(password), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: memoryFor(N, r),
  });
  return [
    PREFIX,
    N,
    r,
    p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const parts = hash.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0)) return false;
  // Refuse absurd parameters from a tampered hash (resource exhaustion).
  if (N > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (expected.length === 0) return false;
  const actual = await scrypt(normalize(password), salt, expected.length, {
    N,
    r,
    p,
    maxmem: memoryFor(N, r),
  });
  return timingSafeEqual(actual, expected);
}
