"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  DEFAULT_AFTER_SIGN_IN,
  clientIp,
  requireSession,
} from "@/platform/auth";
import { acceptLegalDocuments } from "@/platform/legal";

export type AcceptLegalState = { error?: string };

/** The signed-in person accepts the current terms and privacy notice. */
export async function acceptLegalAction(
  _prev: AcceptLegalState,
  formData: FormData,
): Promise<AcceptLegalState> {
  const { user } = await requireSession({
    allowPendingLegal: true,
    allowMissingMfa: true,
  });
  const requestHeaders = await headers();
  const result = await acceptLegalDocuments(
    user.id,
    { accept: formData.get("acceptLegal") === "1" },
    {
      ipAddress: clientIp(requestHeaders),
      userAgent: requestHeaders.get("user-agent"),
    },
  );
  if (!result.ok) return { error: result.error };
  // The MFA gate, if it applies, takes over from here.
  redirect(DEFAULT_AFTER_SIGN_IN);
}
