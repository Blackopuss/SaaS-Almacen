import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auth,
  requestPasswordReset,
  resetPassword,
  signIn,
} from "@/platform/auth";
import { memoryOutboxFor } from "@/platform/email";
import { db } from "@/server";

// PLT-07: password recovery with a single-use, expiring link that closes
// every session and never reveals whether an account exists.
// Each reset and sign-in runs scrypt (slow on purpose): tests get 30 s.

const stamp = Date.now();
const email = `recupera.${stamp}@example.test`;
const oldPassword = "la-contrasena-anterior";
const newPassword = "una-contrasena-nueva-y-larga";
const from = (ip: string) => new Headers({ "x-forwarded-for": ip });

/** Token from the latest reset email sent to `to`. */
function lastResetToken(to: string): string {
  const mail = memoryOutboxFor(to)
    .filter((m) => m.subject === "Restablece tu contraseña de Almacén")
    .at(-1);
  const match = mail?.actionUrl?.match(/\/reset-password\/([^?]+)\?/);
  if (!match) throw new Error(`No reset email for ${to}`);
  return match[1]!;
}

async function createUser(address: string, verified: boolean) {
  await auth.api.signUpEmail({
    body: { name: "Recupera", email: address, password: oldPassword },
  });
  if (verified) {
    await db.user.update({
      where: { email: address },
      data: { emailVerified: true },
    });
  }
}

beforeAll(async () => {
  await createUser(email, true);
}, 30_000);

afterAll(async () => {
  await db.$disconnect();
});

describe("requestPasswordReset", () => {
  it("emails a Spanish single-use link that lands on /restablecer-contrasena", async () => {
    expect(await requestPasswordReset({ email }, from("10.7.0.1"))).toEqual({
      ok: true,
    });
    const mail = memoryOutboxFor(email).at(-1);
    expect(mail?.subject).toBe("Restablece tu contraseña de Almacén");
    expect(mail?.text).toContain("vence en 60 minutos y solo funciona una vez");
    expect(mail?.actionUrl).toMatch(
      /\/api\/auth\/reset-password\/[^?]+\?callbackURL=%2Frestablecer-contrasena$/,
    );
  });

  it("answers an unknown email exactly the same and sends nothing", async () => {
    const ghost = `fantasma.${stamp}@example.test`;
    expect(
      await requestPasswordReset({ email: ghost }, from("10.7.0.2")),
    ).toEqual({ ok: true });
    expect(memoryOutboxFor(ghost)).toHaveLength(0);
  });

  it("rejects an invalid email in Spanish", async () => {
    expect(
      await requestPasswordReset({ email: "no-es-correo" }, from("10.7.0.3")),
    ).toEqual({
      ok: false,
      error: "Escribe un correo válido, por ejemplo nombre@negocio.mx.",
    });
  });

  it("limits requests per email, known or not", async () => {
    const target = `limite.${stamp}@example.test`;
    for (let i = 0; i < 3; i++) {
      expect(
        await requestPasswordReset({ email: target }, from(`10.7.1.${i}`)),
      ).toEqual({ ok: true });
    }
    const blocked = await requestPasswordReset(
      { email: target },
      from("10.7.1.99"),
    );
    expect(blocked.ok === false && blocked.error).toMatch(
      /Demasiados intentos\. Espera 15 minutos/,
    );
  });
});

describe("resetPassword", () => {
  it("validates the new password with the registration policy", async () => {
    const token = lastResetToken(email);
    expect(
      await resetPassword({ token, password: "corta" }, from("10.7.2.1")),
    ).toEqual({
      ok: false,
      reason: "password",
      error: "La contraseña debe tener al menos 12 caracteres.",
    });
    expect(
      await resetPassword(
        { token, password: " ".repeat(12) },
        from("10.7.2.1"),
      ),
    ).toMatchObject({
      reason: "password",
      error: expect.stringMatching(/espacios/),
    });
  });

  it("sets the new password, closes every session and lifts the sign-in block", async () => {
    await auth.api.signInEmail({ body: { email, password: oldPassword } });
    await auth.api.signInEmail({ body: { email, password: oldPassword } });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(2);

    // Lock the account with failed attempts first.
    for (let i = 0; i < 5; i++) {
      await signIn({ email, password: "mala-1234567" }, from(`10.7.3.${i}`));
    }

    const token = lastResetToken(email);
    expect(
      await resetPassword({ token, password: newPassword }, from("10.7.3.9")),
    ).toEqual({ ok: true });

    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(
      await signIn({ email, password: oldPassword }, from("10.7.3.20")),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await signIn({ email, password: newPassword }, from("10.7.3.21")),
    ).toEqual({ ok: true });

    const notice = memoryOutboxFor(email).at(-1);
    expect(notice?.subject).toBe("Tu contraseña de Almacén cambió");
    expect(notice?.actionUrl).toMatch(/\/recuperar-contrasena$/);
  }, 30_000);

  it("refuses a token that was already used", async () => {
    const token = lastResetToken(email);
    expect(
      await resetPassword(
        { token, password: "otra-contrasena-mas" },
        from("10.7.4.1"),
      ),
    ).toEqual({ ok: false, reason: "invalid-token" });
  });

  it("refuses an expired token", async () => {
    await requestPasswordReset({ email }, from("10.7.5.1"));
    const token = lastResetToken(email);
    await db.verification.updateMany({
      where: { identifier: `reset-password:${token}` },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      await resetPassword(
        { token, password: "otra-contrasena-mas" },
        from("10.7.5.1"),
      ),
    ).toEqual({ ok: false, reason: "invalid-token" });
    expect(
      await signIn({ email, password: newPassword }, from("10.7.5.2")),
    ).toEqual({ ok: true });
  }, 30_000);

  it("refuses a made-up token", async () => {
    expect(
      await resetPassword(
        { token: "token-inventado", password: "otra-contrasena-mas" },
        from("10.7.6.1"),
      ),
    ).toEqual({ ok: false, reason: "invalid-token" });
  });

  it("confirms the email of an unverified account (the link proved the mailbox)", async () => {
    const pending = `pendiente.${stamp}@example.test`;
    await createUser(pending, false);
    await requestPasswordReset({ email: pending }, from("10.7.7.1"));
    const token = lastResetToken(pending);
    expect(
      await resetPassword({ token, password: newPassword }, from("10.7.7.1")),
    ).toEqual({ ok: true });
    const user = await db.user.findUniqueOrThrow({
      where: { email: pending },
    });
    expect(user.emailVerified).toBe(true);
  }, 30_000);
});
