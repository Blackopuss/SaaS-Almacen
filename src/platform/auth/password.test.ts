import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password hashing (scrypt, OWASP parameters)", () => {
  const password = "correcto-caballo-bateria-42";

  it("stores the algorithm and parameters with a random salt", async () => {
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    expect(a).toMatch(
      /^scrypt\$32768\$8\$3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/,
    );
    expect(a).not.toBe(b);
    expect(a).not.toContain(password);
  });

  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword(password);
    expect(await verifyPassword({ hash, password })).toBe(true);
    expect(await verifyPassword({ hash, password: `${password}!` })).toBe(
      false,
    );
    expect(await verifyPassword({ hash, password: "" })).toBe(false);
  });

  it("treats Unicode-equivalent passwords as the same (NFKC)", async () => {
    const composed = "contraseñasegura1"; // ñ as one code point
    const decomposed = "contraseñasegura1"; // n + combining tilde
    const hash = await hashPassword(composed);
    expect(await verifyPassword({ hash, password: decomposed })).toBe(true);
  });

  it("rejects malformed or tampered hashes", async () => {
    for (const hash of [
      "",
      "bcrypt$x",
      "scrypt$32768$8$3$c2FsdA==",
      "scrypt$abc$8$3$c2FsdA==$aGFzaA==",
      "scrypt$4294967296$8$3$c2FsdA==$aGFzaA==", // absurd N
      "scrypt$32768$8$3$c2FsdA==$",
    ]) {
      expect(await verifyPassword({ hash, password })).toBe(false);
    }
  });
});
