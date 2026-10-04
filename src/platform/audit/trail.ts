import "server-only";

import { db, forOrganization } from "@/server";

import { listAuditEvents } from "./events";

/**
 * Company audit trail for people (USR-11): each event with a sentence in
 * Spanish, who did it and to whom. Names are read at display time; the
 * event itself keeps only ids, so the record never changes.
 */

/** What each company action means, as shown in the audit screen. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "organization.created": "Creó la empresa",
  "ownership.transfer_offered": "Ofreció transferir la titularidad",
  "ownership.transfer_cancelled": "Canceló la transferencia de titularidad",
  "ownership.transferred": "Aceptó la titularidad de la empresa",
  "product.created": "Creó un producto",
  "product.updated": "Cambió la ficha de un producto",
  "product.archived": "Archivó un producto",
  "product.reactivated": "Reactivó un producto",
  "plan.provisioned": "Se asignó el plan de la empresa",
  "module.activated": "Se activó un módulo",
  "module.deactivated": "Se desactivó un módulo",
  "team.invitation_created": "Invitó a una persona",
  "team.invitation_resent": "Reenvió una invitación",
  "team.invitation_cancelled": "Canceló una invitación",
  "team.invitation_accepted": "Aceptó la invitación y entró al equipo",
  "team.roles_changed": "Cambió los roles de una persona",
  "team.member_disabled": "Desactivó a una persona",
  "team.member_reactivated": "Reactivó a una persona",
};

export function describeAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export type AuditTrailEntry = {
  id: string;
  action: string;
  label: string;
  /** Null when the system made the change or the account no longer exists. */
  actorName: string | null;
  /** Person the change was about, when there is one. */
  targetName: string | null;
  /** Invited address, for invitation events. */
  email: string | null;
  /** Role ids involved: previous and resulting, or the invited ones. */
  rolesFrom: string[];
  rolesTo: string[];
  reason: string | null;
  createdAt: Date;
};

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Newest events of the company first, ready to show. */
export async function listAuditTrail(
  organizationId: string,
  options: { limit?: number; before?: Date } = {},
): Promise<AuditTrailEntry[]> {
  const events = await listAuditEvents(
    forOrganization(organizationId),
    options,
  );
  const invitationIds = events
    .filter((e) => e.targetType === "invitation" && e.targetId)
    .map((e) => e.targetId!);
  const userIds = new Set<string>();
  for (const event of events) {
    if (event.actorUserId) userIds.add(event.actorUserId);
    if (event.targetType === "user" && event.targetId) {
      userIds.add(event.targetId);
    }
  }
  const [users, invitations] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    }),
    forOrganization(organizationId).invitation.findMany({
      where: { id: { in: invitationIds } },
      select: { id: true, email: true, roles: true },
    }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const invited = new Map(invitations.map((i) => [i.id, i]));

  return events.map((event) => {
    const metadata = record(event.metadata);
    const invitation =
      event.targetType === "invitation" && event.targetId
        ? invited.get(event.targetId)
        : undefined;
    const rolesTo = strings(
      metadata.to ??
        metadata.roles ??
        metadata.previousOwnerRoles ??
        invitation?.roles,
    );
    return {
      id: event.id,
      action: event.action,
      label: describeAuditAction(event.action),
      actorName: event.actorUserId
        ? (names.get(event.actorUserId) ?? null)
        : null,
      targetName:
        event.targetType === "user" && event.targetId
          ? (names.get(event.targetId) ?? null)
          : null,
      email:
        typeof metadata.email === "string"
          ? metadata.email
          : (invitation?.email ?? null),
      rolesFrom: strings(metadata.from),
      rolesTo,
      reason: event.reason,
      createdAt: event.createdAt,
    };
  });
}
