import "server-only";

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { auth } from "./auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";
import {
  blockedFor,
  clientIp,
  recordAttempt,
  throttleKeys,
  tooManyAttemptsMessage,
} from "./throttle";

/** Registration input (PLT-02). Messages are shown to people in Spanish. */
export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Escribe tu nombre (mínimo 2 caracteres).")
    .max(120, "El nombre es demasiado largo (máximo 120 caracteres)."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "El correo es demasiado largo.")
    .pipe(z.email("Escribe un correo válido, por ejemplo nombre@negocio.mx.")),
  password: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    )
    .max(
      PASSWORD_MAX_LENGTH,
      `La contraseña puede tener hasta ${PASSWORD_MAX_LENGTH} caracteres.`,
    )
    .refine(
      (value) => value.trim().length > 0,
      "La contraseña no puede ser solo espacios.",
    ),
});

export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterField = keyof RegisterInput;

export type RegisterResult =
  | { ok: true }
  | {
      ok: false;
      fieldErrors: Partial<Record<RegisterField, string>>;
      formError?: string;
    };

/**
 * Creates an account with email and password and sends the verification
 * email. No session starts until the email is confirmed (PLT-03).
 */
export async function registerUser(
  input: RegisterInput,
  headers: Headers,
): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<RegisterField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as RegisterField;
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const ipKey = throttleKeys.registerIp(clientIp(headers));
  const wait = await blockedFor([ipKey]);
  if (wait > 0) {
    return {
      ok: false,
      fieldErrors: {},
      formError: tooManyAttemptsMessage(wait),
    };
  }
  await recordAttempt([ipKey]);

  try {
    // Email link lands on /correo-verificado, which explains the result.
    await auth.api.signUpEmail({
      body: { ...parsed.data, callbackURL: "/correo-verificado" },
      headers,
    });
    // Same answer for new and existing emails (no account enumeration).
    return { ok: true };
  } catch (error) {
    if (isAPIError(error)) {
      const code = String(error.body?.code ?? "");
      if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
        return {
          ok: false,
          fieldErrors: {
            password: "La contraseña no cumple la longitud requerida.",
          },
        };
      }
    }
    console.error("registerUser failed", error);
    return {
      ok: false,
      fieldErrors: {},
      formError:
        "No pudimos crear tu cuenta. Inténtalo de nuevo en un momento.",
    };
  }
}

const resendSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email("Escribe un correo válido, por ejemplo nombre@negocio.mx.")),
});

export type ResendResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a new verification link. Answers the same whether or not the
 * account exists or is already verified (no enumeration). Limited per
 * email and per IP (PLT-06).
 */
export async function resendVerification(
  input: { email: string },
  headers: Headers,
): Promise<ResendResult> {
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }
  const keys = [
    throttleKeys.resendEmail(parsed.data.email),
    throttleKeys.resendIp(clientIp(headers)),
  ];
  const wait = await blockedFor(keys);
  if (wait > 0) return { ok: false, error: tooManyAttemptsMessage(wait) };
  await recordAttempt(keys);

  try {
    await auth.api.sendVerificationEmail({
      body: { email: parsed.data.email, callbackURL: "/correo-verificado" },
      headers,
    });
  } catch (error) {
    // Unknown or verified emails also end here; the answer stays the same.
    if (!isAPIError(error)) console.error("resendVerification failed", error);
  }
  return { ok: true };
}
