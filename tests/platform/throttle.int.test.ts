import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Each attempt runs scrypt (slow on purpose): the 20-attempt tests get 60 s.

import {
  auth,
  registerUser,
  resendVerification,
  signIn,
} from "@/platform/auth";
import { db } from "@/server";

// PLT-06: brute force is blocked per account and per IP, without revealing
// whether an account exists, and limits expire.

const password = "una-frase-larga-y-segura";
const stamp = Date.now();
const victim = `victima.${stamp}@example.test`;
const bystander = `tercero.${stamp}@example.test`;
const from = (ip: string) => new Headers({ "x-forwarded-for": ip });

beforeAll(async () => {
  for (const email of [victim, bystander]) {
    await auth.api.signUpEmail({ body: { name: "Límite", email, password } });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
  }
});

afterAll(async () => {
  await db.$disconnect();
});

/** Moves every counter into the past, as if the block had expired. */
async function expireLimits() {
  await db.$executeRawUnsafe(
    "UPDATE auth_throttle SET windowStart = UTC_TIMESTAMP(3) - INTERVAL 2 HOUR, blockedUntil = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND",
  );
}

describe("per-account limit", () => {
  it("blocks an account after 5 failures, even with the right password", async () => {
    for (let i = 0; i < 5; i++) {
      // Different IPs: the account limit applies regardless of origin.
      const result = await signIn(
        { email: victim, password: "mala-123456" },
        from(`10.0.0.${i + 1}`),
      );
      expect(result).toEqual({ ok: false, reason: "invalid" });
    }
    const blocked = await signIn(
      { email: victim, password },
      from("10.0.0.99"),
    );
    expect(blocked).toMatchObject({ ok: false, reason: "throttled" });
    expect(
      blocked.ok === false && "message" in blocked && blocked.message,
    ).toMatch(/Demasiados intentos\. Espera 15 minutos/);
  });

  it("does not affect other accounts", async () => {
    expect(
      await signIn({ email: bystander, password }, from("10.0.0.50")),
    ).toEqual({ ok: true });
  });

  it("treats an unknown email exactly like an existing one", async () => {
    const ghost = `fantasma.${stamp}@example.test`;
    for (let i = 0; i < 5; i++) {
      expect(
        await signIn(
          { email: ghost, password: "mala-123456" },
          from(`10.1.0.${i + 1}`),
        ),
      ).toEqual({ ok: false, reason: "invalid" });
    }
    expect(
      await signIn({ email: ghost, password }, from("10.1.0.99")),
    ).toMatchObject({
      ok: false,
      reason: "throttled",
    });
  });

  it("lets the account in again once the block expires, and resets on success", async () => {
    await expireLimits();
    expect(
      await signIn({ email: victim, password }, from("10.0.0.99")),
    ).toEqual({ ok: true });
    const rows = await db.authThrottle.findMany({
      where: { key: { startsWith: "signin:acct:" } },
    });
    expect(rows.some((r) => r.key.includes(victim))).toBe(false); // emails are hashed
  });
});

describe("per-IP limit", () => {
  it("blocks an IP after 20 failures across different emails", async () => {
    await expireLimits();
    for (let i = 0; i < 20; i++) {
      await signIn(
        { email: `intento${i}.${stamp}@example.test`, password: "x" },
        from("203.0.113.7"),
      );
    }
    expect(
      await signIn({ email: bystander, password }, from("203.0.113.7")),
    ).toMatchObject({
      ok: false,
      reason: "throttled",
    });
    expect(
      await signIn({ email: bystander, password }, from("203.0.113.8")),
    ).toEqual({
      ok: true,
    });
  }, 60_000);
});

describe("registration and verification emails", () => {
  it("limits registrations per IP", async () => {
    await expireLimits();
    for (let i = 0; i < 10; i++) {
      await registerUser(
        { name: "Masivo", email: `masivo${i}.${stamp}@example.test`, password },
        from("198.51.100.4"),
      );
    }
    const blocked = await registerUser(
      { name: "Masivo", email: `masivo-extra.${stamp}@example.test`, password },
      from("198.51.100.4"),
    );
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.formError).toMatch(/Demasiados intentos/);
  });

  it("limits verification emails per address", async () => {
    await expireLimits();
    for (let i = 0; i < 3; i++) {
      expect(
        await resendVerification({ email: victim }, from(`192.0.2.${i}`)),
      ).toEqual({
        ok: true,
      });
    }
    const blocked = await resendVerification(
      { email: victim },
      from("192.0.2.200"),
    );
    expect(blocked.ok).toBe(false);
  });
});

describe("Better Auth HTTP endpoints", () => {
  it("rate-limits /api/auth/sign-in/email per IP", async () => {
    const base = process.env.BETTER_AUTH_URL!;
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const response = await auth.handler(
        new Request(`${base}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: new URL(base).origin,
            "x-forwarded-for": "198.51.100.77",
          },
          body: JSON.stringify({ email: bystander, password: "mala-123456" }),
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  }, 60_000);
});
