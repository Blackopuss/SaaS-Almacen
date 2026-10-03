"use server";

import { headers } from "next/headers";

import { resetPassword } from "@/platform/auth";

export type ResetFormState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "invalid-token" }
  | { status: "error"; error: string; field?: "password" };

export async function resetAction(
  _prev: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const result = await resetPassword(
    {
      token: String(formData.get("token") ?? ""),
      password: String(formData.get("password") ?? ""),
    },
    await headers(),
  );
  if (result.ok) return { status: "done" };
  if (result.reason === "password") {
    return { status: "error", error: result.error, field: "password" };
  }
  if (result.reason === "invalid-token") return { status: "invalid-token" };
  return {
    status: "error",
    error:
      "No pudimos cambiar tu contraseña. Inténtalo de nuevo en un momento.",
  };
}
