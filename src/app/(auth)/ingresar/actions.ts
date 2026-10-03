"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeRedirectPath, signIn } from "@/platform/auth";

export type SignInFormState = { error?: string; email: string };

const MESSAGES = {
  invalid: "Correo o contraseña incorrectos.",
  unavailable: "No pudimos iniciar sesión. Inténtalo de nuevo en un momento.",
} as const;

export async function signInAction(
  _prev: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeRedirectPath(formData.get("siguiente"));

  const result = await signIn({ email, password }, await headers());
  if (result.ok) redirect(next);
  // A new verification link was sent automatically (sendOnSignIn).
  if (result.reason === "unverified") redirect("/verifica-tu-correo");
  if (result.reason === "mfa") {
    redirect(`/verificar-codigo?siguiente=${encodeURIComponent(next)}`);
  }
  if (result.reason === "throttled") return { error: result.message, email };
  return { error: MESSAGES[result.reason], email };
}
