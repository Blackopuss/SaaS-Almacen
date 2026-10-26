"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { registerUser, type RegisterField } from "@/platform/auth";

export type RegisterFormState = {
  fieldErrors: Partial<Record<RegisterField, string>>;
  formError?: string;
  /** Echoed back so the form keeps what was typed (never the password). */
  values: { name: string; email: string; acceptLegal: boolean };
};

export async function registerAction(
  _prev: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const input = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    acceptLegal: formData.get("acceptLegal") === "1",
  };

  const result = await registerUser(input, await headers());
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values: {
        name: input.name,
        email: input.email,
        acceptLegal: input.acceptLegal,
      },
    };
  }
  redirect("/verifica-tu-correo");
}
