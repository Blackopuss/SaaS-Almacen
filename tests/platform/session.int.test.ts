import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auth, signIn } from "@/platform/auth";
import { db } from "@/server";

// PLT-04: sign-in answers, secure cookies and CSRF protection.

const password = "una-frase-larga-y-segura";
const verified = `ingreso.${Date.now()}@example.test`;
const pending = `pendiente.${Date.now()}@example.test`;
const base = process.env.BETTER_AUTH_URL!;

beforeAll(async () => {
  for (const email of [verified, pending]) {
    await auth.api.signUpEmail({ body: { name: "Ingreso", email, password } });
  }
  await db.user.update({
    where: { email: verified },
    data: { emailVerified: true },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

const noHeaders = () => new Headers();

describe("signIn (service)", () => {
  it("gives the same answer for an unknown email and a wrong password", async () => {
    expect(
      await signIn({ email: "nadie@example.test", password }, noHeaders()),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await signIn(
        { email: verified, password: "incorrecta-123" },
        noHeaders(),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await signIn({ email: "", password: "" }, noHeaders())).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("reports an unverified account only with the right password", async () => {
    expect(await signIn({ email: pending, password }, noHeaders())).toEqual({
      ok: false,
      reason: "unverified",
    });
  });
});

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Lax, site-wide and lasts 7 days", async () => {
    const response = await auth.api.signInEmail({
      body: { email: verified.toUpperCase(), password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.includes("session_token="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie!)?.[1]);
    expect(maxAge).toBe(60 * 60 * 24 * 7);
  });
});

describe("CSRF protection", () => {
  it("rejects a sign-in POST coming from another website", async () => {
    const response = await auth.handler(
      new Request(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          cookie: "better-auth.session_token=x",
        },
        body: JSON.stringify({ email: verified, password }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("accepts the same request from the application origin", async () => {
    const response = await auth.handler(
      new Request(`${base}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(base).origin,
          cookie: "better-auth.session_token=x",
        },
        body: JSON.stringify({ email: verified, password }),
      }),
    );
    expect(response.status).toBe(200);
  });
});
