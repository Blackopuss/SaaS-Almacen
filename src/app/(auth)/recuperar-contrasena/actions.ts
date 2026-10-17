"use server";

import { headers } from "next/headers";

import { requestPasswordReset } from "@/platform/auth";

export type RecoverFormState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; error: string; email: string };

export async function recoverAction(
  _prev: RecoverFormState,
  formData: FormData,
): Promise<RecoverFormState> {
  const email = String(formData.get("email") ?? "");
  const result = await requestPasswordReset({ email }, await headers());
  return result.ok
    ? { status: "sent" }
    : { status: "error", error: result.error, email };
}
