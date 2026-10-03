import "server-only";

import { newId } from "@/lib";
import { db, type TenantDb } from "@/server";

import {
  sanitizeMetadata,
  type AuditMetadata,
  type SafeJsonObject,
} from "./sanitize";

/**
 * Audit log (PLT-14). Append-only (database triggers reject UPDATE and
 * DELETE). Two kinds:
 * - company events (`recordAuditEvent`): who changed what in a company and
 *   why; written with the same client as the change, inside its
 *   transaction, so the change and its record exist together;
 * - account security events (`recordSecurityEvent`): password, MFA and
 *   sessions of one person.
 * Metadata is sanitized: no passwords, tokens, codes or secrets.
 */

const ACTION = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

function checkAction(action: string) {
  if (!ACTION.test(action) || action.length > 80) {
    throw new Error(`Invalid audit action "${action}"`);
  }
}

export type AuditEventInput = {
  organizationId: string;
  /** Null for changes made by the system. */
  actorUserId: string | null;
  /** Dotted name, e.g. "organization.created", "inventory.adjustment". */
  action: string;
  target?: { type: string; id: string };
  /** Reason given by the person, when the action asks for one. */
  reason?: string;
  metadata?: AuditMetadata;
  ipAddress?: string | null;
};

type AuditEventData = {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  metadata?: SafeJsonObject;
  ipAddress: string | null;
};

/** Anything that can create audit rows: a transaction or a scoped client. */
type AuditWriter = {
  auditEvent: { create(args: { data: AuditEventData }): PromiseLike<unknown> };
};

/** Records a company event with the client (or transaction) of the change. */
export async function recordAuditEvent(
  client: AuditWriter,
  event: AuditEventInput,
): Promise<void> {
  checkAction(event.action);
  const metadata = sanitizeMetadata(event.metadata);
  await client.auditEvent.create({
    data: {
      id: newId(),
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      action: event.action,
      targetType: event.target?.type.slice(0, 40) ?? null,
      targetId: event.target?.id.slice(0, 64) ?? null,
      reason: event.reason?.trim().slice(0, 500) || null,
      ...(metadata ? { metadata } : {}),
      ipAddress: event.ipAddress?.slice(0, 64) ?? null,
    },
  });
}

export type SecurityEventInput = {
  userId: string;
  action: string;
  metadata?: AuditMetadata;
  ipAddress?: string | null;
};

/**
 * Records an account security event. Never breaks the operation that
 * triggered it: a failure is logged and the operation goes on.
 */
export async function recordSecurityEvent(
  event: SecurityEventInput,
): Promise<void> {
  checkAction(event.action);
  const metadata = sanitizeMetadata(event.metadata);
  try {
    await db.securityEvent.create({
      data: {
        id: newId(),
        userId: event.userId,
        action: event.action,
        ...(metadata ? { metadata } : {}),
        ipAddress: event.ipAddress?.slice(0, 64) ?? null,
      },
    });
  } catch (error) {
    console.error("recordSecurityEvent failed", event.action, error);
  }
}

export type AuditEventRow = {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: Date;
};

/** Newest company events first (for USR-11 and support). */
export async function listAuditEvents(
  client: TenantDb,
  options: { limit?: number; before?: Date } = {},
): Promise<AuditEventRow[]> {
  return client.auditEvent.findMany({
    where: options.before ? { createdAt: { lt: options.before } } : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    select: {
      id: true,
      actorUserId: true,
      action: true,
      targetType: true,
      targetId: true,
      reason: true,
      metadata: true,
      createdAt: true,
    },
  });
}

/** Newest security events of one person first. */
export async function listSecurityEvents(userId: string, limit = 50) {
  return db.securityEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true, action: true, metadata: true, createdAt: true },
  });
}
