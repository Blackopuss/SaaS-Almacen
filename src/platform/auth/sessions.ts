import "server-only";

import { describeUserAgent, formatIp } from "@/lib";
import { recordSecurityEvent } from "@/platform/audit";
import { db } from "@/server";

/**
 * Active sessions of the signed-in user (PLT-05). Queries are always scoped
 * to the owner, and session tokens never leave the server: the UI only
 * knows session ids. Sessions are checked against the database on every
 * request (no cookie cache), so a revoked session stops working at once.
 */
export type ActiveSession = {
  id: string;
  current: boolean;
  label: string;
  mobile: boolean;
  ipAddress: string | null;
  createdAt: Date;
  lastActiveAt: Date;
};

export async function listActiveSessions(
  userId: string,
  currentSessionId: string,
): Promise<ActiveSession[]> {
  const sessions = await db.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return sessions
    .map((s) => {
      const device = describeUserAgent(s.userAgent);
      return {
        id: s.id,
        current: s.id === currentSessionId,
        label: device.label,
        mobile: device.mobile,
        ipAddress: formatIp(s.ipAddress),
        createdAt: s.createdAt,
        lastActiveAt: s.updatedAt,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/**
 * Ends one of the user's other sessions. Returns false when the session
 * does not exist, belongs to someone else, or is the current one (signing
 * out the current session is a separate action).
 */
export async function revokeSession(
  userId: string,
  sessionId: string,
  currentSessionId: string,
): Promise<boolean> {
  if (sessionId === currentSessionId) return false;
  const { count } = await db.session.deleteMany({
    where: { id: sessionId, userId },
  });
  if (count === 1) {
    await recordSecurityEvent({ userId, action: "session.revoked" });
  }
  return count === 1;
}

/** Ends every session of the user except the current one. */
export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: { userId, id: { not: currentSessionId } },
  });
  if (count > 0) {
    await recordSecurityEvent({
      userId,
      action: "session.revoked_others",
      metadata: { count },
    });
  }
  return count;
}
