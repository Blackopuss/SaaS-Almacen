import "server-only";

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { auth } from "./auth";
import { newPasswordSchema } from "./register";
import {
  blockedFor,
  clientIp,
  recordAttempt,
  throttleKeys,
  tooManyAttemptsMessage,
} from "./throttle";

/**
 * Password recovery (PLT-07). The email link goes through Better Auth
 * (/api/auth/reset-password/:token), which checks the token and lands on
 * /restablecer-contrasena with ?token=... or ?error=INVALID_TOKEN. The token
 * works once and expires (RESET_PASSWORD_MINUTES). A successful reset closes
 * every session of the account and lifts its sign-in block (see auth.ts).
 */

const requestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email("Escribe un correo válido, por ejemplo nombre@negocio.mx.")),
});

export type PasswordResetRequestResult =
  { ok: true } | { ok: false; error: string };

/**
 * Emails a reset link. Answers the same whether or not the account exists
 * (no enumeration). Limited per email and per IP.
 */
export async function requestPasswordReset(
  input: { email: string },
  headers: Headers,
): Promise<PasswordResetRequestResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }
  const keys = [
    throttleKeys.resetEmail(parsed.data.email),
    throttleKeys.resetIp(clientIp(headers)),
  ];
  const wait = await blockedFor(keys);
  if (wait > 0) return { ok: false, error: tooManyAttemptsMessage(wait) };
  await recordAttempt(keys);

  try {
    await auth.api.requestPasswordReset({
      body: { email: parsed.data.email, redirectTo: "/restablecer-contrasena" },
      headers,
    });
  } catch (error) {
    // The answer stays the same; only unexpected failures are logged.
    console.error("requestPasswordReset failed", error);
  }
  return { ok: true };
}

const resetSchema = z.object({
  token: z.string().trim().min(1).max(256),
  password: newPasswordSchema,
});

export type PasswordResetResult =
  | { ok: true }
  | { ok: false; reason: "password"; error: string }
  | { ok: false; reason: "invalid-token" | "unavailable" };

/** Sets a new password with a reset token from the email link. */
export async function resetPassword(
  input: { token: string; password: string },
  headers: Headers,
): Promise<PasswordResetResult> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return issue.path[0] === "password"
      ? { ok: false, reason: "password", error: issue.message }
      : { ok: false, reason: "invalid-token" };
  }

  try {
    await auth.api.resetPassword({
      body: { token: parsed.data.token, newPassword: parsed.data.password },
      headers,
    });
    return { ok: true };
  } catch (error) {
    if (isAPIError(error)) {
      const code = String(error.body?.code ?? "");
      if (code === "INVALID_TOKEN" || code === "USER_NOT_FOUND") {
        return { ok: false, reason: "invalid-token" };
      }
      if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
        return {
          ok: false,
          reason: "password",
          error: "La contraseña no cumple la longitud requerida.",
        };
      }
    }
    console.error("resetPassword failed", error);
    return { ok: false, reason: "unavailable" };
  }
}
