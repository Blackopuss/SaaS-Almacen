import "server-only";

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import {
  backupCodesRegeneratedEmail,
  mfaDisabledEmail,
  sendEmail,
} from "@/platform/email";
import { db } from "@/server";

import { auth } from "./auth";
import { normalizeBackupCode } from "./backup-codes";
import { normalizeTotpCode } from "./mfa";
import { isMfaRequired } from "./mfa-policy";
import {
  blockedFor,
  clearAttempts,
  recordAttempt,
  throttleKeys,
  tooManyAttemptsMessage,
} from "./throttle";

/**
 * Backup codes and turning MFA off (PLT-09), for the signed-in user.
 * Both need the password again; turning MFA off also needs a current code
 * (app or backup), is refused when MFA is mandatory and emails the owner.
 * Wrong passwords and codes count toward RULES.mfaSetup.
 */

const passwordSchema = z.string().min(1).max(1024);

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const WRONG_PASSWORD = "La contraseña no es correcta.";

async function owner(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, name: true, twoFactorEnabled: true },
  });
}

/** Replaces all backup codes; the old ones stop working. */
export async function regenerateBackupCodes(
  userId: string,
  input: { password: string },
  headers: Headers,
): Promise<Result<{ backupCodes: string[] }>> {
  const password = passwordSchema.safeParse(input.password);
  if (!password.success) {
    return { ok: false, error: "Escribe tu contraseña para continuar." };
  }
  const key = throttleKeys.mfaSetup(userId);
  const wait = await blockedFor([key]);
  if (wait > 0) return { ok: false, error: tooManyAttemptsMessage(wait) };

  try {
    const result = await auth.api.generateBackupCodes({
      body: { password: password.data },
      headers,
    });
    await clearAttempts([key]);
    const user = await owner(userId);
    await sendEmail(
      backupCodesRegeneratedEmail({ to: user.email, name: user.name }),
    );
    return { ok: true, backupCodes: result.backupCodes };
  } catch (error) {
    if (isAPIError(error) && error.body?.code === "INVALID_PASSWORD") {
      await recordAttempt([key]);
      return { ok: false, error: WRONG_PASSWORD };
    }
    if (isAPIError(error) && error.body?.code === "TWO_FACTOR_NOT_ENABLED") {
      return {
        ok: false,
        error: "La verificación en dos pasos no está activada.",
      };
    }
    console.error("regenerateBackupCodes failed", error);
    return {
      ok: false,
      error: "No pudimos generar los códigos. Inténtalo de nuevo.",
    };
  }
}

/** Turns MFA off after checking the password and a current code. */
export async function disableMfa(
  userId: string,
  input: { password: string; code: string },
  headers: Headers,
): Promise<Result> {
  if (await isMfaRequired(userId)) {
    return {
      ok: false,
      error:
        "Como titular de la empresa, la verificación en dos pasos es obligatoria.",
    };
  }
  const user = await owner(userId);
  if (!user.twoFactorEnabled) {
    return {
      ok: false,
      error: "La verificación en dos pasos ya está desactivada.",
    };
  }
  const password = passwordSchema.safeParse(input.password);
  if (!password.success) {
    return { ok: false, error: "Escribe tu contraseña para continuar." };
  }
  const raw = String(input.code ?? "");
  const totp = normalizeTotpCode(raw);
  const backup = totp ? null : normalizeBackupCode(raw);
  if (!totp && !backup) {
    return {
      ok: false,
      error:
        "Escribe el código de 6 números de tu app o uno de tus códigos de recuperación.",
    };
  }
  const key = throttleKeys.mfaSetup(userId);
  const wait = await blockedFor([key]);
  if (wait > 0) return { ok: false, error: tooManyAttemptsMessage(wait) };

  try {
    await auth.api.verifyPassword({
      body: { password: password.data },
      headers,
    });
  } catch (error) {
    if (isAPIError(error) && error.body?.code === "INVALID_PASSWORD") {
      await recordAttempt([key]);
      return { ok: false, error: WRONG_PASSWORD };
    }
    throw error;
  }

  try {
    if (totp) await auth.api.verifyTOTP({ body: { code: totp }, headers });
    else await auth.api.verifyBackupCode({ body: { code: backup! }, headers });
  } catch (error) {
    const code = isAPIError(error) ? String(error.body?.code ?? "") : "";
    if (code === "INVALID_CODE" || code === "INVALID_BACKUP_CODE") {
      await recordAttempt([key]);
      return { ok: false, error: "El código no es válido." };
    }
    throw error;
  }

  // Better Auth deletes the secret and codes and rotates the session.
  await auth.api.disableTwoFactor({
    body: { password: password.data },
    headers,
  });
  await clearAttempts([key]);
  await sendEmail(mfaDisabledEmail({ to: user.email, name: user.name }));
  return { ok: true };
}
