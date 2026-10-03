"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  confirmTotpEnrollment,
  requireSession,
  revokeOtherSessions,
  revokeSession,
  startTotpEnrollment,
} from "@/platform/auth";

export type SessionActionResult = { ok: boolean; message: string };

export async function revokeSessionAction(
  sessionId: string,
): Promise<SessionActionResult> {
  const { user, sessionId: current } = await requireSession();
  const revoked = await revokeSession(user.id, String(sessionId), current);
  revalidatePath("/configuracion");
  return revoked
    ? { ok: true, message: "Sesión cerrada en ese dispositivo." }
    : { ok: false, message: "Esa sesión ya no estaba activa." };
}

export async function revokeOtherSessionsAction(): Promise<SessionActionResult> {
  const { user, sessionId } = await requireSession();
  const count = await revokeOtherSessions(user.id, sessionId);
  revalidatePath("/configuracion");
  return {
    ok: true,
    message:
      count === 1
        ? "Se cerró 1 sesión en otro dispositivo."
        : `Se cerraron ${count} sesiones en otros dispositivos.`,
  };
}

export type MfaSetupState =
  | { step: "password"; error?: string }
  | { step: "scan"; totpUri: string; secret: string; error?: string }
  | { step: "done" };

/** Two-step MFA enrollment (PLT-08A): password, then the app's code. */
export async function mfaSetupAction(
  prev: MfaSetupState,
  formData: FormData,
): Promise<MfaSetupState> {
  // Also used by the mandatory setup screen, before MFA is on.
  const { user } = await requireSession({ allowMissingMfa: true });
  const requestHeaders = await headers();

  if (prev.step === "scan") {
    const result = await confirmTotpEnrollment(
      user.id,
      { code: String(formData.get("code") ?? "") },
      requestHeaders,
    );
    if (!result.ok) return { ...prev, error: result.error };
    revalidatePath("/", "layout");
    return { step: "done" };
  }

  const result = await startTotpEnrollment(
    user.id,
    { password: String(formData.get("password") ?? "") },
    requestHeaders,
  );
  return result.ok
    ? { step: "scan", totpUri: result.totpUri, secret: result.secret }
    : { step: "password", error: result.error };
}
