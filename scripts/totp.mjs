// TOTP helpers for local tooling only (seed, demo:codigo, verify:ui).
// Same algorithm as authenticator apps (RFC 6238: SHA-1, 6 digits, 30 s).
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 form of a raw secret, as authenticator apps expect it. */
export function base32(raw) {
  let bits = "";
  for (const byte of Buffer.from(raw, "utf8")) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  }
  return out;
}

/** Current 30-second step. */
export const totpStep = () => Math.floor(Date.now() / 30_000);

/** Code for a raw secret at a given step (default: now). */
export function totpCode(raw, step = totpStep()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", Buffer.from(raw, "utf8"))
    .update(counter)
    .digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}
