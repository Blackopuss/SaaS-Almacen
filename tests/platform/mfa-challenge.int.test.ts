import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  auth,
  confirmTotpEnrollment,
  isMfaRequired,
  signIn,
  startTotpEnrollment,
  verifySignInCode,
} from "@/platform/auth";
import { db } from "@/server";

// PLT-08B: with MFA on, the password alone opens no session; the code is
// checked per challenge, works once, and MFA is required for titulares.

const password = "una-frase-larga-y-segura";
const stamp = Date.now();
const email = `reto.${stamp}@example.test`;
const from = (ip: string, cookie = "") =>
  new Headers({ "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) });

/** RFC 6238 code from the base32 key shown to the person. */
function totp(base32Secret: string, offsetSteps = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "")) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(Math.floor(Date.now() / 30_000) + offsetSteps),
  );
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

function cookieFrom(response: Response, name: string): string {
  return (
    response.headers
      .getSetCookie()
      .find((c) => c.includes(`${name}=`) && !c.includes("Max-Age=0"))
      ?.split(";")[0] ?? ""
  );
}

/** Password step as the browser does it; returns the challenge cookie. */
async function startChallenge(): Promise<string> {
  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const body = (await response.clone().json()) as {
    twoFactorRedirect?: boolean;
  };
  expect(body.twoFactorRedirect).toBe(true);
  return cookieFrom(response, "better-auth.two_factor");
}

let userId = "";
let secret = "";
/** Last code that opened a session (for the replay test). */
let usedCode = "";

beforeAll(async () => {
  await auth.api.signUpEmail({ body: { name: "Reto", email, password } });
  const user = await db.user.update({
    where: { email },
    data: { emailVerified: true },
  });
  userId = user.id;
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const headers = from(
    "10.8.0.1",
    cookieFrom(signedIn, "better-auth.session_token"),
  );
  const started = await startTotpEnrollment(userId, { password }, headers);
  if (!started.ok) throw new Error(started.error);
  secret = started.secret;
  const confirmed = await confirmTotpEnrollment(
    userId,
    { code: totp(secret) },
    headers,
  );
  if (!confirmed.ok) throw new Error(confirmed.error);
  // Codes used during setup must not count as "used" for these tests.
  await db.authThrottle.deleteMany({ where: { key: { startsWith: "mfa:" } } });
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("sign-in with MFA on", () => {
  it("accepts the password but opens no session yet", async () => {
    await db.session.deleteMany({ where: { userId } });
    expect(await signIn({ email, password }, from("10.8.1.1"))).toEqual({
      ok: false,
      reason: "mfa",
    });
    expect(await db.session.count({ where: { userId } })).toBe(0);
  }, 30_000);

  it("refuses a code without the challenge cookie", async () => {
    expect(
      await verifySignInCode({ code: totp(secret) }, from("10.8.2.1")),
    ).toMatchObject({ ok: false, reason: "restart" });
  });

  it("refuses a wrong code and keeps the challenge open", async () => {
    const challenge = await startChallenge();
    const wrong = await verifySignInCode(
      { code: totp(secret, 10) },
      from("10.8.3.1", challenge),
    );
    expect(wrong).toMatchObject({ ok: false, reason: "invalid" });
    expect(await db.session.count({ where: { userId } })).toBe(0);

    usedCode = totp(secret);
    expect(
      await verifySignInCode({ code: usedCode }, from("10.8.3.1", challenge)),
    ).toEqual({ ok: true });
    expect(await db.session.count({ where: { userId } })).toBe(1);
  }, 30_000);

  it("does not accept the same code twice", async () => {
    // Same code the previous test signed in with.
    const challenge = await startChallenge();
    const before = await db.session.count({ where: { userId } });
    expect(
      await verifySignInCode({ code: usedCode }, from("10.8.4.1", challenge)),
    ).toMatchObject({
      ok: false,
      reason: "restart",
      error: expect.stringMatching(/ya se usó/),
    });
    expect(await db.session.count({ where: { userId } })).toBe(before);
  }, 30_000);

  it("ends the challenge after 5 wrong codes", async () => {
    const challenge = await startChallenge();
    for (let i = 0; i < 5; i++) {
      expect(
        await verifySignInCode(
          { code: totp(secret, 20 + i) },
          from("10.8.5.1", challenge),
        ),
      ).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(
      await verifySignInCode(
        { code: totp(secret, 1) },
        from("10.8.5.1", challenge),
      ),
    ).toMatchObject({ ok: false, reason: "restart" });
  }, 30_000);

  it("keeps MFA after a password reset (recovery does not bypass it)", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.twoFactorEnabled).toBe(true);
    await auth.api.requestPasswordReset({ body: { email } });
    const token = (
      await db.verification.findFirstOrThrow({
        where: { identifier: { startsWith: "reset-password:" }, value: userId },
        orderBy: { createdAt: "desc" },
      })
    ).identifier.replace("reset-password:", "");
    await auth.api.resetPassword({
      body: { token, newPassword: password },
    });
    expect(await signIn({ email, password }, from("10.8.6.1"))).toEqual({
      ok: false,
      reason: "mfa",
    });
  }, 30_000);
});

describe("isMfaRequired", () => {
  it("is false for an account that owns no company", async () => {
    expect(await isMfaRequired(userId)).toBe(false);
  });

  it("is true for the titular of a company", async () => {
    const owner = await db.user.create({
      data: {
        id: newId(),
        email: `titular.${stamp}@example.test`,
        name: "Titular",
        emailVerified: true,
      },
    });
    await db.organization.create({
      data: {
        id: newId(),
        name: "Ferretería de prueba",
        ownerUserId: owner.id,
        memberships: { create: { id: newId(), userId: owner.id } },
      },
    });
    expect(await isMfaRequired(owner.id)).toBe(true);
  });
});
