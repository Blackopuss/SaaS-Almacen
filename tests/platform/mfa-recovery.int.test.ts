import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  auth,
  confirmTotpEnrollment,
  disableMfa,
  getMfaStatus,
  regenerateBackupCodes,
  startTotpEnrollment,
  verifySignInCode,
} from "@/platform/auth";
import { memoryOutboxFor } from "@/platform/email";
import { db } from "@/server";

// PLT-09: backup codes work once and only through the same sign-in
// controls; turning MFA off needs the password and a current code and is
// refused when MFA is mandatory.

const password = "una-frase-larga-y-segura";
const stamp = Date.now();
const from = (ip: string, cookie = "") =>
  new Headers({ "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) });

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

type Account = {
  email: string;
  userId: string;
  secret: string;
  backupCodes: string[];
};

/** Verified account with MFA on, as a person would set it up. */
async function accountWithMfa(email: string): Promise<Account> {
  await auth.api.signUpEmail({
    body: { name: "Recupera MFA", email, password },
  });
  const user = await db.user.update({
    where: { email },
    data: { emailVerified: true },
  });
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const headers = from(
    "10.9.0.1",
    cookieFrom(signedIn, "better-auth.session_token"),
  );
  const started = await startTotpEnrollment(user.id, { password }, headers);
  if (!started.ok) throw new Error(started.error);
  const confirmed = await confirmTotpEnrollment(
    user.id,
    { code: totp(started.secret) },
    headers,
  );
  if (!confirmed.ok) throw new Error(confirmed.error);
  return {
    email,
    userId: user.id,
    secret: started.secret,
    backupCodes: confirmed.backupCodes,
  };
}

/** Password step; returns the MFA challenge cookie. */
async function challenge(email: string): Promise<string> {
  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return cookieFrom(response, "better-auth.two_factor");
}

/** Full sign-in through the app code; returns the session cookie. */
async function sessionFor(account: Account, step = 0): Promise<string> {
  const response = await auth.api.verifyTOTP({
    body: { code: totp(account.secret, step) },
    headers: from("10.9.0.2", await challenge(account.email)),
    asResponse: true,
  });
  return cookieFrom(response, "better-auth.session_token");
}

let person: Account;

beforeAll(async () => {
  person = await accountWithMfa(`respaldo.${stamp}@example.test`);
}, 60_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("backup codes", () => {
  it("are shown once at activation: 10 easy-to-type codes", async () => {
    expect(person.backupCodes).toHaveLength(10);
    for (const code of person.backupCodes) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    }
    expect((await getMfaStatus(person.userId)).backupCodesLeft).toBe(10);
  });

  it("open a session once, typed loosely, and the owner is told", async () => {
    const code = person.backupCodes[0]!;
    const typed = code.toUpperCase().replace("-", " ");
    expect(
      await verifySignInCode(
        { code: typed, method: "backup" },
        from("10.9.1.1", await challenge(person.email)),
      ),
    ).toEqual({ ok: true });
    expect((await getMfaStatus(person.userId)).backupCodesLeft).toBe(9);
    const notice = memoryOutboxFor(person.email).at(-1);
    expect(notice?.subject).toBe("Entraste con un código de recuperación");
    expect(notice?.text).toContain("Te quedan 9 códigos");

    expect(
      await verifySignInCode(
        { code, method: "backup" },
        from("10.9.1.2", await challenge(person.email)),
      ),
    ).toEqual({
      ok: false,
      reason: "invalid",
      error: "Ese código de recuperación no es válido o ya se usó.",
    });
  }, 30_000);

  it("need the challenge: a backup code alone opens nothing", async () => {
    expect(
      await verifySignInCode(
        { code: person.backupCodes[1]!, method: "backup" },
        from("10.9.2.1"),
      ),
    ).toMatchObject({ ok: false, reason: "restart" });
    expect((await getMfaStatus(person.userId)).backupCodesLeft).toBe(9);
  });

  it("share the 5-tries limit of the challenge", async () => {
    const cookie = await challenge(person.email);
    for (let i = 0; i < 5; i++) {
      expect(
        await verifySignInCode(
          { code: `zzzzz-zzzz${i + 2}`, method: "backup" },
          from("10.9.3.1", cookie),
        ),
      ).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(
      await verifySignInCode(
        { code: person.backupCodes[1]!, method: "backup" },
        from("10.9.3.1", cookie),
      ),
    ).toMatchObject({ ok: false, reason: "restart" });
  }, 30_000);

  it("can be replaced with the password; old ones stop working", async () => {
    const session = await sessionFor(person);
    expect(
      await regenerateBackupCodes(
        person.userId,
        { password: "no-es-la-contrasena" },
        from("10.9.4.1", session),
      ),
    ).toEqual({ ok: false, error: "La contraseña no es correcta." });

    const result = await regenerateBackupCodes(
      person.userId,
      { password },
      from("10.9.4.1", session),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backupCodes).toHaveLength(10);
    expect(result.backupCodes).not.toContain(person.backupCodes[2]);
    expect(memoryOutboxFor(person.email).at(-1)?.subject).toBe(
      "Generaste nuevos códigos de recuperación",
    );
    expect(
      await verifySignInCode(
        { code: person.backupCodes[2]!, method: "backup" },
        from("10.9.4.2", await challenge(person.email)),
      ),
    ).toMatchObject({ ok: false, reason: "invalid" });
    person.backupCodes = result.backupCodes;
  }, 30_000);
});

describe("turning MFA off", () => {
  it("needs the right password and a valid code", async () => {
    const session = await sessionFor(person, 1);
    expect(
      await disableMfa(
        person.userId,
        { password: "no-es-la-contrasena", code: totp(person.secret) },
        from("10.9.5.1", session),
      ),
    ).toEqual({ ok: false, error: "La contraseña no es correcta." });
    expect(
      await disableMfa(
        person.userId,
        { password, code: totp(person.secret, 10) },
        from("10.9.5.1", session),
      ),
    ).toEqual({ ok: false, error: "El código no es válido." });
    expect(
      await disableMfa(
        person.userId,
        { password, code: "hola" },
        from("10.9.5.1", session),
      ),
    ).toMatchObject({ ok: false });
    expect((await getMfaStatus(person.userId)).enabled).toBe(true);
  }, 30_000);

  it("works with a backup code and emails the owner", async () => {
    const session = await sessionFor(person, -1);
    expect(
      await disableMfa(
        person.userId,
        { password, code: person.backupCodes[0]! },
        from("10.9.6.1", session),
      ),
    ).toEqual({ ok: true });
    expect(await getMfaStatus(person.userId)).toEqual({
      enabled: false,
      required: false,
      backupCodesLeft: 0,
    });
    expect(await db.twoFactor.count({ where: { userId: person.userId } })).toBe(
      0,
    );
    expect(memoryOutboxFor(person.email).at(-1)?.subject).toBe(
      "Desactivaste la verificación en dos pasos",
    );
  }, 30_000);

  it("is refused for a titular, even with valid proof", async () => {
    const owner = await accountWithMfa(`titular.mfa.${stamp}@example.test`);
    await db.organization.create({
      data: {
        id: newId(),
        name: "Ferretería obligatoria",
        ownerUserId: owner.userId,
        memberships: { create: { id: newId(), userId: owner.userId } },
      },
    });
    const session = await sessionFor(owner, 1);
    expect(
      await disableMfa(
        owner.userId,
        { password, code: owner.backupCodes[0]! },
        from("10.9.7.1", session),
      ),
    ).toEqual({
      ok: false,
      error:
        "La verificación en dos pasos es obligatoria para titulares y administradores.",
    });
    const status = await getMfaStatus(owner.userId);
    expect(status).toEqual({
      enabled: true,
      required: true,
      backupCodesLeft: 10,
    });
  }, 60_000);
});
