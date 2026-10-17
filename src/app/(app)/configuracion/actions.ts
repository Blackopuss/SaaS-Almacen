"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import {
  confirmTotpEnrollment,
  disableMfa,
  regenerateBackupCodes,
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
  /** MFA is on; the backup codes are shown once (PLT-09). */
  | { step: "codes"; backupCodes: string[] };

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
    return { step: "codes", backupCodes: result.backupCodes };
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

export type BackupCodesState = { error?: string; backupCodes?: string[] };

/** Replaces the backup codes after checking the password (PLT-09). */
export async function regenerateBackupCodesAction(
  _prev: BackupCodesState,
  formData: FormData,
): Promise<BackupCodesState> {
  const { user } = await requireSession();
  const result = await regenerateBackupCodes(
    user.id,
    { password: String(formData.get("password") ?? "") },
    await headers(),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/configuracion");
  return { backupCodes: result.backupCodes };
}

export type DisableMfaState = { error?: string; done?: boolean };

/** Turns MFA off with the password and a current code (PLT-09). */
export async function disableMfaAction(
  _prev: DisableMfaState,
  formData: FormData,
): Promise<DisableMfaState> {
  const { user } = await requireSession();
  const result = await disableMfa(
    user.id,
    {
      password: String(formData.get("password") ?? ""),
      code: String(formData.get("code") ?? ""),
    },
    await headers(),
  );
  // No revalidation here: the dialog reports success first, then the
  // client refreshes (re-rendering now would unmount the dialog).
  return result.ok ? { done: true } : { error: result.error };
}
