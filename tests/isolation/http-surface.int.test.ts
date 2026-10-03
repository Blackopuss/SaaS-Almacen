import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  auth,
  confirmTotpEnrollment,
  handleAuthRequest,
  startTotpEnrollment,
} from "@/platform/auth";
import { db } from "@/server";

// PLT-15: the HTTP surface of Better Auth (/api/auth/*). Every flow of the
// app goes through server actions that apply our rules (attempt limits,
// mandatory MFA, password + code to turn MFA off). Calling Better Auth's
// endpoints directly must not skip them: only the two links sent by email
// are reachable over HTTP.

const BASE = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const password = "una-frase-larga-y-segura";
const stamp = Date.now();
const email = `http.${stamp}@example.test`;
let cookie = "";
let userId = "";
let sessionsBefore = 0;

function totp(base32Secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "")) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0");
}

function sessionCookieOf(response: Response): string {
  return (
    response.headers
      .getSetCookie()
      .find((c) => c.includes("session_token=") && !c.includes("Max-Age=0"))
      ?.split(";")[0] ?? ""
  );
}

function request(method: string, path: string, body?: unknown) {
  return new Request(`${BASE}/api/auth${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  // A titular with MFA on, signed in.
  await auth.api.signUpEmail({
    body: { name: "Titular HTTP", email, password },
  });
  const user = await db.user.update({
    where: { email },
    data: { emailVerified: true },
  });
  userId = user.id;
  await db.organization.create({
    data: {
      id: newId(),
      name: "Ferretería HTTP",
      ownerUserId: userId,
      memberships: { create: { id: newId(), userId } },
    },
  });
  cookie = sessionCookieOf(
    await auth.api.signInEmail({ body: { email, password }, asResponse: true }),
  );
  const headers = new Headers({ cookie });
  const started = await startTotpEnrollment(userId, { password }, headers);
  if (!started.ok) throw new Error(started.error);
  const confirmed = await confirmTotpEnrollment(
    userId,
    { code: totp(started.secret) },
    headers,
  );
  if (!confirmed.ok) throw new Error(confirmed.error);
  // Enrollment rotated the session: sign in again with password + code.
  const challenge = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const twoFactor =
    challenge.headers
      .getSetCookie()
      .find((c) => c.includes("two_factor="))
      ?.split(";")[0] ?? "";
  cookie = sessionCookieOf(
    await auth.api.verifyTOTP({
      body: { code: totp(started.secret) },
      headers: new Headers({ cookie: twoFactor }),
      asResponse: true,
    }),
  );
  sessionsBefore = await db.session.count({ where: { userId } });
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("Better Auth over HTTP", () => {
  it("the session cookie used below is valid (the test is not vacuous)", async () => {
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.id).toBe(userId);
  });

  it("a titular cannot turn MFA off with just the password", async () => {
    const response = await handleAuthRequest(
      request("POST", "/two-factor/disable", { password }),
    );
    expect(response.status).toBe(404);
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.twoFactorEnabled).toBe(true);
  });

  it.each([
    ["POST", "/sign-in/email", { email, password }],
    [
      "POST",
      "/sign-up/email",
      { name: "X", email: `x.${stamp}@example.test`, password },
    ],
    ["GET", "/get-session", undefined],
    ["GET", "/list-sessions", undefined],
    ["POST", "/revoke-sessions", {}],
    ["POST", "/update-user", { name: "Otro nombre" }],
    [
      "POST",
      "/change-password",
      { currentPassword: password, newPassword: `${password}-2` },
    ],
    ["POST", "/two-factor/get-totp-uri", { password }],
    ["POST", "/two-factor/generate-backup-codes", { password }],
    ["POST", "/two-factor/enable", { password }],
    ["POST", "/request-password-reset", { email }],
    ["POST", "/reset-password", { token: "x", newPassword: `${password}-3` }],
    ["POST", "/send-verification-email", { email }],
    ["POST", "/sign-out", {}],
  ])("%s %s is not reachable", async (method, path, body) => {
    const response = await handleAuthRequest(request(method, path, body));
    expect(response.status).toBe(404);
  });

  it("the links sent by email still work", async () => {
    const verify = await handleAuthRequest(
      request(
        "GET",
        "/verify-email?token=invalido&callbackURL=%2Fcorreo-verificado",
      ),
    );
    expect(verify.status).not.toBe(404);
    const reset = await handleAuthRequest(
      request(
        "GET",
        "/reset-password/invalido?callbackURL=%2Frestablecer-contrasena",
      ),
    );
    expect(reset.status).toBe(302);
    expect(reset.headers.get("location")).toContain("error=INVALID_TOKEN");
  });

  it("nothing changed through the blocked calls", async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.name).toBe("Titular HTTP");
    expect(user.twoFactorEnabled).toBe(true);
    expect(await db.session.count({ where: { userId } })).toBe(sessionsBefore);
  });
});
