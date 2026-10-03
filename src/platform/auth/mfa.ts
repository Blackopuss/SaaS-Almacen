import "server-only";

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { mfaEnabledEmail, sendEmail } from "@/platform/email";
import { db } from "@/server";

import { TOTP_DIGITS, auth } from "./auth";
import { isMfaRequired } from "./mfa-policy";
import {
  blockedFor,
  clearAttempts,
  clientIp,
  recordAttempt,
  throttleKeys,
  tooManyAttemptsMessage,
} from "./throttle";

/**
 * MFA enrollment with an authenticator app (PLT-08A). Two steps, both for
 * the signed-in user (`headers` carry the session cookie):
 * 1. `startTotpEnrollment` re-checks the password and creates a new secret
 *    (stored encrypted, not active yet).
 * 2. `confirmTotpEnrollment` checks the first code from the app; only then
 *    is MFA on for the account. Better Auth also rotates the session.
 * Wrong passwords and codes are limited per user (RULES.mfaSetup).
 */

export { isMfaRequired } from "./mfa-policy";

export type MfaStatus = { enabled: boolean; required: boolean };

export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  });
  return {
    enabled: user?.twoFactorEnabled ?? false,
    required: await isMfaRequired(userId),
  };
}

export type StartTotpResult =
  | {
      ok: true;
      /** otpauth:// link for the QR code. */
      totpUri: string;
      /** Same secret in base32, for typing it by hand. */
      secret: string;
    }
  | { ok: false; error: string };

export async function startTotpEnrollment(
  userId: string,
  input: { password: string },
  headers: Headers,
): Promise<StartTotpResult> {
  const password = z.string().max(1024).safeParse(input.password);
  if (!password.success || !password.data) {
    return { ok: false, error: "Escribe tu contraseña para continuar." };
  }
  const key = throttleKeys.mfaSetup(userId);
  const wait = await blockedFor([key]);
  if (wait > 0) return { ok: false, error: tooManyAttemptsMessage(wait) };

  try {
    const result = await auth.api.enableTwoFactor({
      body: { password: password.data, method: "totp" },
      headers,
    });
    if (result.method !== "totp" || !result.totpURI) {
      throw new Error("enableTwoFactor did not return a TOTP URI");
    }
    const secret = new URL(result.totpURI).searchParams.get("secret") ?? "";
    // The right password proves who this is: start the count over.
    await clearAttempts([key]);
    return { ok: true, totpUri: result.totpURI, secret };
  } catch (error) {
    if (isAPIError(error)) {
      const code = String(error.body?.code ?? "");
      if (code === "INVALID_PASSWORD") {
        await recordAttempt([key]);
        return { ok: false, error: "La contraseña no es correcta." };
      }
      if (code === "TOTP_ALREADY_ENABLED") {
        return {
          ok: false,
          error: "La verificación en dos pasos ya está activada.",
        };
      }
    }
    console.error("startTotpEnrollment failed", error);
    return {
      ok: false,
      error: "No pudimos iniciar la activación. Inténtalo de nuevo.",
    };
  }
}

/** Accepts "123 456" or "123456"; returns the digits or null. */
export function normalizeTotpCode(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(digits) ? digits : null;
}

export type ConfirmTotpResult = { ok: true } | { ok: false; error: string };

export async function confirmTotpEnrollment(
  userId: string,
  input: { code: string },
  headers: Headers,
): Promise<ConfirmTotpResult> {
  const code = normalizeTotpCode(String(input.code ?? ""));
  if (!code) {
    return {
      ok: false,
      error: `Escribe los ${TOTP_DIGITS} números que muestra tu app.`,
    };
  }
  const key = throttleKeys.mfaSetup(userId);
  const wait = await blockedFor([key]);
  if (wait > 0) return { ok: false, error: tooManyAttemptsMessage(wait) };

  const pending = await db.twoFactor.findUnique({
    where: { userId },
    select: { verified: true },
  });
  if (!pending) {
    return { ok: false, error: "Vuelve a empezar la activación." };
  }
  if (pending.verified) {
    return {
      ok: false,
      error: "La verificación en dos pasos ya está activada.",
    };
  }

  try {
    await auth.api.verifyTOTP({ body: { code }, headers });
  } catch (error) {
    if (isAPIError(error) && error.body?.code === "INVALID_CODE") {
      await recordAttempt([key]);
      return {
        ok: false,
        error:
          "El código no coincide. Revisa que la hora de tu teléfono sea automática y usa el código más reciente.",
      };
    }
    console.error("confirmTotpEnrollment failed", error);
    return {
      ok: false,
      error: "No pudimos confirmar el código. Inténtalo de nuevo.",
    };
  }

  await clearAttempts([key]);
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, name: true },
  });
  await sendEmail(mfaEnabledEmail({ to: user.email, name: user.name }));
  return { ok: true };
}

export type SignInCodeResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; error: string }
  /** The challenge expired, was used up or the code was replayed. */
  | { ok: false; reason: "restart"; error: string };

/**
 * Second step of signing in with MFA on (PLT-08B). `headers` must carry the
 * challenge cookie set by signIn; the session starts only here. Each code
 * works once, wrong codes are limited per challenge, per account (Better
 * Auth) and per IP.
 */
export async function verifySignInCode(
  input: { code: string },
  headers: Headers,
): Promise<SignInCodeResult> {
  const code = normalizeTotpCode(String(input.code ?? ""));
  if (!code) {
    return {
      ok: false,
      reason: "invalid",
      error: `Escribe los ${TOTP_DIGITS} números que muestra tu app.`,
    };
  }
  const ipKey = throttleKeys.mfaChallengeIp(clientIp(headers));
  const wait = await blockedFor([ipKey]);
  if (wait > 0) {
    return {
      ok: false,
      reason: "invalid",
      error: tooManyAttemptsMessage(wait),
    };
  }

  let session: { token: string; userId: string };
  try {
    const result = await auth.api.verifyTOTP({ body: { code }, headers });
    session = { token: result.token, userId: result.user.id };
  } catch (error) {
    const errorCode = isAPIError(error) ? String(error.body?.code ?? "") : "";
    if (errorCode === "INVALID_CODE") {
      await recordAttempt([ipKey]);
      return {
        ok: false,
        reason: "invalid",
        error: "El código no coincide. Usa el código más reciente de tu app.",
      };
    }
    if (errorCode === "ACCOUNT_TEMPORARILY_LOCKED") {
      return {
        ok: false,
        reason: "restart",
        error:
          "Demasiados códigos incorrectos. Espera 15 minutos e inicia sesión de nuevo.",
      };
    }
    if (
      errorCode === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" ||
      errorCode === "INVALID_TWO_FACTOR_COOKIE" ||
      errorCode === "TOTP_NOT_ENABLED"
    ) {
      return {
        ok: false,
        reason: "restart",
        error: "Tu verificación venció. Inicia sesión de nuevo.",
      };
    }
    console.error("verifySignInCode failed", error);
    return {
      ok: false,
      reason: "invalid",
      error: "No pudimos verificar el código. Inténtalo de nuevo.",
    };
  }

  // One-time use: a code seen before (e.g. read over someone's shoulder)
  // does not open a second session.
  const usedKey = throttleKeys.totpUsed(session.userId, code);
  if ((await blockedFor([usedKey])) > 0) {
    await db.session.deleteMany({ where: { token: session.token } });
    return {
      ok: false,
      reason: "restart",
      error:
        "Ese código ya se usó. Espera a que tu app muestre uno nuevo e inicia sesión de nuevo.",
    };
  }
  await recordAttempt([usedKey]);
  return { ok: true };
}
