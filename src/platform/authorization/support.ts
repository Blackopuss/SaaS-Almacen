import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { openSupportAccess, supportWindowFor } from "@/platform/tenancy";
import { LOCKING_TRANSACTION, db, forOrganization } from "@/server";

import { assertOwnerAction } from "./access";
import { lockOrganization } from "./seats";

/**
 * Support access (PIL-12, ADR 0029). The titular opens it for a fixed time
 * and may close it before; while open, platform staff may enter the company
 * from the internal console and read it as Consulta. Opening, closing,
 * entering and leaving are written to the company's audit trail, which the
 * titular sees.
 */

/** How long an access stays open when the titular grants it. */
export const SUPPORT_ACCESS_HOURS = 24;

type Actor = { organizationId: string; userId: string };

export type SupportAccessView = {
  /** Open until this moment, or null when there is none. */
  until: Date | null;
};

/** What the titular sees in Configuración. */
export async function getSupportAccess(
  organizationId: string,
): Promise<SupportAccessView> {
  const open = await openSupportAccess(organizationId);
  return { until: open?.until ?? null };
}

/**
 * Opens support access for SUPPORT_ACCESS_HOURS. With one already open it
 * answers that one: asking twice does not stretch it.
 */
export async function grantSupportAccess(
  actor: Actor,
): Promise<{ until: Date; repeated: boolean }> {
  await assertOwnerAction(
    actor.organizationId,
    actor.userId,
    "platform.support.grant",
  );
  return db.$transaction(async (tx) => {
    // One at a time per company: the company row is the lock.
    await lockOrganization(tx, actor.organizationId);
    const open = await tx.supportAccess.findFirst({
      where: {
        organizationId: actor.organizationId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { expiresAt: true },
    });
    if (open) return { until: open.expiresAt, repeated: true };
    const until = new Date(Date.now() + SUPPORT_ACCESS_HOURS * 3_600_000);
    const id = newId();
    await tx.supportAccess.create({
      data: {
        id,
        organizationId: actor.organizationId,
        grantedByUserId: actor.userId,
        expiresAt: until,
      },
    });
    await recordAuditEvent(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "support.granted",
      target: { type: "support_access", id },
      metadata: { hours: SUPPORT_ACCESS_HOURS },
    });
    return { until, repeated: false };
  }, LOCKING_TRANSACTION);
}

/** Closes any open support access now; support loses it on its next click. */
export async function revokeSupportAccess(
  actor: Actor,
): Promise<{ closed: boolean }> {
  await assertOwnerAction(
    actor.organizationId,
    actor.userId,
    "platform.support.grant",
  );
  return db.$transaction(async (tx) => {
    const now = new Date();
    const open = await tx.supportAccess.findMany({
      where: {
        organizationId: actor.organizationId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    for (const row of open) {
      await tx.supportAccess.update({
        where: { id: row.id },
        data: { revokedAt: now, revokedByUserId: actor.userId },
      });
      await recordAuditEvent(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "support.revoked",
        target: { type: "support_access", id: row.id },
      });
    }
    return { closed: open.length > 0 };
  });
}

/** Companies whose titular keeps support access open, for the console. */
export async function listOpenSupportAccess(): Promise<
  { organizationId: string; name: string; until: Date }[]
> {
  // The one query across companies: the console lists them all.
  const rows = await db.supportAccess.findMany({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: "asc" },
    select: {
      organizationId: true,
      expiresAt: true,
      organization: { select: { name: true } },
    },
    take: 100,
  });
  return rows.map((row) => ({
    organizationId: row.organizationId,
    name: row.organization.name,
    until: row.expiresAt,
  }));
}

export type EnterSupportResult = { ok: true } | { ok: false; error: string };

const CLOSED = "Esta empresa no tiene abierto el acceso de soporte.";

/**
 * Platform staff enters a company as support: only staff, only while the
 * titular's access is open. The session's active company changes; the
 * audit trail of the company says who entered.
 */
export async function enterSupport(
  staffUserId: string,
  sessionId: string,
  organizationId: string,
): Promise<EnterSupportResult> {
  const window = await supportWindowFor(String(organizationId), staffUserId);
  if (!window) return { ok: false, error: CLOSED };
  await db.$transaction(async (tx) => {
    const updated = await tx.session.updateMany({
      where: { id: sessionId, userId: staffUserId },
      data: { activeOrganizationId: organizationId },
    });
    if (updated.count !== 1) throw new Error("Session not found");
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: staffUserId,
      action: "support.entered",
      target: { type: "support_access", id: window.id },
    });
  });
  return { ok: true };
}

/**
 * Leaves the company support is looking into: written to its trail, and the
 * session goes back to the person's own company (or none).
 */
export async function leaveSupport(
  staffUserId: string,
  sessionId: string,
): Promise<void> {
  const session = await db.session.findFirst({
    where: { id: sessionId, userId: staffUserId },
    select: { activeOrganizationId: true },
  });
  const organizationId = session?.activeOrganizationId;
  if (!organizationId) return;
  // Only leaving a company where the person is support, not a member.
  const member = await forOrganization(organizationId).membership.count({
    where: { userId: staffUserId, status: "ACTIVE" },
  });
  if (member > 0) return;
  await db.$transaction(async (tx) => {
    await tx.session.updateMany({
      where: { id: sessionId, userId: staffUserId },
      data: { activeOrganizationId: null },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: staffUserId,
      action: "support.left",
      target: { type: "organization", id: organizationId },
    });
  });
}
