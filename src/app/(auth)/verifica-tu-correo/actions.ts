"use server";

import { headers } from "next/headers";

import { resendVerification } from "@/platform/auth";

export type ResendFormState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; error: string; email: string };

export async function resendAction(
  _prev: ResendFormState,
  formData: FormData,
): Promise<ResendFormState> {
  const email = String(formData.get("email") ?? "");
  const result = await resendVerification({ email }, await headers());
  return result.ok
    ? { status: "sent" }
    : { status: "error", error: result.error, email };
}
