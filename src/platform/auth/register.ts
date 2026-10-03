import "server-only";

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { auth } from "./auth";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";

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
  | { ok: true; userId: string }
  | {
      ok: false;
      fieldErrors: Partial<Record<RegisterField, string>>;
      formError?: string;
    };

/**
 * Creates an account with email and password and starts a session
 * (cookies are set through Better Auth's nextCookies plugin).
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

  try {
    const result = await auth.api.signUpEmail({ body: parsed.data, headers });
    return { ok: true, userId: result.user.id };
  } catch (error) {
    if (isAPIError(error)) {
      const code = String(error.body?.code ?? "");
      if (code.startsWith("USER_ALREADY_EXISTS")) {
        // PLT-03 replaces this with a neutral, email-based flow (no enumeration).
        return {
          ok: false,
          fieldErrors: {
            email: "Ya existe una cuenta con este correo.",
          },
        };
      }
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
