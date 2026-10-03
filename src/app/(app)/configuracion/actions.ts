"use server";

import { revalidatePath } from "next/cache";

import {
  requireSession,
  revokeOtherSessions,
  revokeSession,
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
