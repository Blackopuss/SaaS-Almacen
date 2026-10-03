import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auth,
  confirmTotpEnrollment,
  getMfaStatus,
  startTotpEnrollment,
} from "@/platform/auth";
import { memoryOutboxFor } from "@/platform/email";
import { db } from "@/server";

// PLT-08A: MFA enrollment with an authenticator app. The password is
// checked again, the secret is stored encrypted, and MFA is on only after
// the first code from the app is confirmed.

const password = "una-frase-larga-y-segura";
const stamp = Date.now();
const email = `mfa.${stamp}@example.test`;

/** RFC 6238 code computed independently, like an authenticator app would. */
function totp(base32Secret: string, offsetSteps = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(
    BigInt(Math.floor(Date.now() / 1000 / 30) + offsetSteps),
  );
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((c) => c.includes("session_token=") && !c.includes("Max-Age=0"))
    ?.split(";")[0];
}

let userId = "";
let cookie = "";
const withSession = () => new Headers({ cookie });

beforeAll(async () => {
  await auth.api.signUpEmail({ body: { name: "Doble Paso", email, password } });
  const user = await db.user.update({
    where: { email },
    data: { emailVerified: true },
  });
  userId = user.id;
  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  cookie = sessionCookie(response)!;
}, 30_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("startTotpEnrollment", () => {
  it("starts disabled", async () => {
    expect(await getMfaStatus(userId)).toEqual({
      enabled: false,
      required: false,
    });
  });

  it("refuses a wrong password without creating a secret", async () => {
    expect(
      await startTotpEnrollment(
        userId,
        { password: "no-es-la-contrasena" },
        withSession(),
      ),
    ).toEqual({ ok: false, error: "La contraseña no es correcta." });
    expect(await db.twoFactor.count({ where: { userId } })).toBe(0);
  }, 30_000);

  it("returns an otpauth link and stores the secret encrypted, not yet active", async () => {
    const result = await startTotpEnrollment(
      userId,
      { password },
      withSession(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const uri = new URL(result.totpUri);
    expect(uri.protocol).toBe("otpauth:");
    expect(decodeURIComponent(uri.pathname)).toContain(email);
    expect(uri.searchParams.get("issuer")).toBe("Almacén");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(result.secret).toMatch(/^[A-Z2-7]+=*$/);

    const row = await db.twoFactor.findUniqueOrThrow({ where: { userId } });
    expect(row.verified).toBe(false);
    expect(row.secret).not.toContain(result.secret);
    expect(await getMfaStatus(userId)).toEqual({
      enabled: false,
      required: false,
    });
  }, 30_000);
});

describe("confirmTotpEnrollment", () => {
  let secret = "";

  beforeAll(async () => {
    const started = await startTotpEnrollment(
      userId,
      { password },
      withSession(),
    );
    if (!started.ok) throw new Error(started.error);
    secret = started.secret;
  }, 30_000);

  it("asks for six digits", async () => {
    expect(
      await confirmTotpEnrollment(userId, { code: "12ab" }, withSession()),
    ).toEqual({
      ok: false,
      error: "Escribe los 6 números que muestra tu app.",
    });
  });

  it("refuses a wrong code and keeps MFA off", async () => {
    const wrong = totp(secret, 10);
    const result = await confirmTotpEnrollment(
      userId,
      { code: wrong },
      withSession(),
    );
    expect(result.ok === false && result.error).toMatch(/no coincide/);
    expect(await getMfaStatus(userId)).toEqual({
      enabled: false,
      required: false,
    });
  });

  it("turns MFA on with the app's current code, rotates the session and emails the owner", async () => {
    const before = await db.session.findMany({ where: { userId } });
    const code = totp(secret);
    expect(
      await confirmTotpEnrollment(
        userId,
        { code: `${code.slice(0, 3)} ${code.slice(3)}` },
        withSession(),
      ),
    ).toEqual({ ok: true });
    expect(await getMfaStatus(userId)).toEqual({
      enabled: true,
      required: false,
    });
    const row = await db.twoFactor.findUniqueOrThrow({ where: { userId } });
    expect(row.verified).toBe(true);

    // The old session is replaced by a new one (no session fixation).
    expect(await auth.api.getSession({ headers: withSession() })).toBeNull();
    const after = await db.session.findMany({ where: { userId } });
    expect(after).toHaveLength(before.length);
    expect(after.map((s) => s.id)).not.toContain(before[0]!.id);

    expect(memoryOutboxFor(email).at(-1)?.subject).toBe(
      "Activaste la verificación en dos pasos",
    );
  });

  it("does not confirm twice once active", async () => {
    expect(
      await confirmTotpEnrollment(
        userId,
        { code: totp(secret) },
        withSession(),
      ),
    ).toEqual({
      ok: false,
      error: "La verificación en dos pasos ya está activada.",
    });
  });

  it("sign-in with only the password no longer opens a session", async () => {
    const result = await auth.api.signInEmail({ body: { email, password } });
    expect(result).toMatchObject({ twoFactorRedirect: true });
  }, 30_000);
});

describe("setup limit", () => {
  it("blocks after 5 wrong passwords", async () => {
    const other = `mfa.limite.${stamp}@example.test`;
    await auth.api.signUpEmail({
      body: { name: "Límite", email: other, password },
    });
    const user = await db.user.update({
      where: { email: other },
      data: { emailVerified: true },
    });
    const response = await auth.api.signInEmail({
      body: { email: other, password },
      asResponse: true,
    });
    const headers = new Headers({ cookie: sessionCookie(response)! });
    for (let i = 0; i < 5; i++) {
      await startTotpEnrollment(
        user.id,
        { password: "mala-123456789" },
        headers,
      );
    }
    const blocked = await startTotpEnrollment(user.id, { password }, headers);
    expect(blocked.ok === false && blocked.error).toMatch(
      /Demasiados intentos/,
    );
  }, 60_000);
});
