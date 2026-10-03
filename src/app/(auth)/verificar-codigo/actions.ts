"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeRedirectPath, verifySignInCode } from "@/platform/auth";

export type CodeFormState = { error?: string; restart?: boolean };

export async function verifyCodeAction(
  _prev: CodeFormState,
  formData: FormData,
): Promise<CodeFormState> {
  const next = safeRedirectPath(formData.get("siguiente"));
  const result = await verifySignInCode(
    { code: String(formData.get("code") ?? "") },
    await headers(),
  );
  if (result.ok) redirect(next);
  return { error: result.error, restart: result.reason === "restart" };
}
