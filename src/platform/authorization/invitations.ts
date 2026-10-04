import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import {
  blockedFor,
  recordAttempt,
  throttleKeys,
  tooManyAttemptsMessage,
} from "@/platform/auth";
import { invitationEmail, sendEmail } from "@/platform/email";
import { db, forOrganization } from "@/server";

import { loadSubject } from "./access";
import { ROLE_LABELS, isRole, type Role } from "./catalog";
import { can } from "./policy";
import { TEAM_RULE_MESSAGES, checkInvitationRoles } from "./team-rules";

/**
 * Invitations by email (USR-04). Someone with `platform.team.invite` sends
 * a link to an address with the roles already chosen. The link carries a
 * random token (256 bits); the database keeps only its SHA-256, so a copy
 * of the table cannot be used to join. It works once and expires.
 */

export const INVITATION_DAYS = 7;
export const INVITATION_PATH = "/invitacion";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "El correo es demasiado largo.")
  .pipe(z.email("Escribe un correo válido, por ejemplo nombre@negocio.mx."));

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type InvitationField = "email" | "roles";

export type CreateInvitationResult =
  | { ok: true; invitationId: string; expiresAt: Date }
  | {
      ok: false;
      fieldErrors: Partial<Record<InvitationField, string>>;
      formError?: string;
    };

const invalid = (
  fieldErrors: Partial<Record<InvitationField, string>>,
  formError?: string,
): CreateInvitationResult => ({
  ok: false,
  fieldErrors,
  ...(formError ? { formError } : {}),
});

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Creates the invitation row inside `tx` and returns the token for the link. */
async function issue(
  tx: Tx,
  input: {
    organizationId: string;
    actorUserId: string;
    email: string;
    roles: Role[];
    action: "team.invitation_created" | "team.invitation_resent";
  },
) {
  const now = new Date();
  // One live invitation per address: a new one replaces the previous link.
  await tx.invitation.updateMany({
    where: {
      organizationId: input.organizationId,
      email: input.email,
      status: "PENDING",
    },
    data: { status: "CANCELLED", resolvedAt: now },
  });
  const token = randomBytes(32).toString("base64url");
  const invitationId = newId();
  const expiresAt = new Date(
    now.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000,
  );
  await tx.invitation.create({
    data: {
      id: invitationId,
      organizationId: input.organizationId,
      email: input.email,
      tokenHash: hashInvitationToken(token),
      roles: input.roles,
      invitedByUserId: input.actorUserId,
      expiresAt,
    },
  });
  await recordAuditEvent(tx, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    target: { type: "invitation", id: invitationId },
    metadata: { email: input.email, roles: input.roles },
  });
  return { token, invitationId, expiresAt };
}

async function deliver(
  organizationId: string,
  actorUserId: string,
  email: string,
  roles: Role[],
  token: string,
) {
  const [organization, inviter] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
    db.user.findUnique({ where: { id: actorUserId }, select: { name: true } }),
  ]);
  await sendEmail(
    invitationEmail({
      to: email,
      organizationName: organization?.name ?? "tu empresa",
      inviterName: inviter?.name ?? "Tu equipo",
      roleLabels: roles.map((role) => ROLE_LABELS[role]),
      url: `${process.env.BETTER_AUTH_URL ?? ""}${INVITATION_PATH}?token=${token}`,
      days: INVITATION_DAYS,
    }),
  );
}

/**
 * Invites an address to the company with the given roles. Refused when the
 * person may not invite, may not hand out those roles, or the address
 * already is in the team.
 */
export async function createInvitation(
  organizationId: string,
  actorUserId: string,
  input: { email: string; roles: readonly string[] },
): Promise<CreateInvitationResult> {
  const subject = await loadSubject(organizationId, actorUserId);
  const rule = checkInvitationRoles(subject, input.roles);
  if (!rule.ok) {
    return rule.reason === "forbidden"
      ? invalid({}, TEAM_RULE_MESSAGES.forbidden)
      : invalid({ roles: TEAM_RULE_MESSAGES[rule.reason] });
  }
  const roles = input.roles.filter(isRole);

  const email = emailSchema.safeParse(input.email);
  if (!email.success) {
    return invalid({ email: email.error.issues[0]!.message });
  }

  const key = [throttleKeys.inviteOrganization(organizationId)];
  const wait = await blockedFor(key);
  if (wait > 0) return invalid({}, tooManyAttemptsMessage(wait));

  const member = await forOrganization(organizationId).membership.findFirst({
    where: { user: { email: email.data } },
    select: { status: true },
  });
  if (member) {
    return invalid({
      email:
        member.status === "ACTIVE"
          ? "Esta persona ya es parte de tu equipo."
          : "Esta persona está desactivada en tu equipo. Reactívala en lugar de invitarla.",
    });
  }
  await recordAttempt(key);

  const issued = await db.$transaction((tx) =>
    issue(tx, {
      organizationId,
      actorUserId,
      email: email.data,
      roles,
      action: "team.invitation_created",
    }),
  );
  await deliver(organizationId, actorUserId, email.data, roles, issued.token);
  return {
    ok: true,
    invitationId: issued.invitationId,
    expiresAt: issued.expiresAt,
  };
}

export type InvitationActionResult =
  { ok: true } | { ok: false; error: string };

const GONE = "Esta invitación ya no está disponible.";

/** Sends a fresh link for a pending invitation; the old link stops working. */
export async function resendInvitation(
  organizationId: string,
  actorUserId: string,
  invitationId: string,
): Promise<InvitationActionResult> {
  const subject = await loadSubject(organizationId, actorUserId);
  const invitation = await forOrganization(organizationId).invitation.findFirst(
    {
      where: { id: String(invitationId), status: "PENDING" },
      select: { email: true, roles: true },
    },
  );
  const stored = invitation?.roles;
  const roles = Array.isArray(stored) ? stored.filter(isRole) : [];
  if (!can(subject, "platform.invitation.resend")) {
    return { ok: false, error: TEAM_RULE_MESSAGES.forbidden };
  }
  if (!invitation || roles.length === 0) return { ok: false, error: GONE };
  // Only the titular handles invitations that name an administrator.
  if (subject.isOwner !== true && roles.includes("administrator")) {
    return { ok: false, error: TEAM_RULE_MESSAGES.administrator_reserved };
  }

  const key = [throttleKeys.inviteOrganization(organizationId)];
  const wait = await blockedFor(key);
  if (wait > 0) return { ok: false, error: tooManyAttemptsMessage(wait) };
  await recordAttempt(key);

  const issued = await db.$transaction((tx) =>
    issue(tx, {
      organizationId,
      actorUserId,
      email: invitation.email,
      roles,
      action: "team.invitation_resent",
    }),
  );
  await deliver(
    organizationId,
    actorUserId,
    invitation.email,
    roles,
    issued.token,
  );
  return { ok: true };
}

/** Cancels a pending invitation; its link stops working. */
export async function cancelInvitation(
  organizationId: string,
  actorUserId: string,
  invitationId: string,
): Promise<InvitationActionResult> {
  const subject = await loadSubject(organizationId, actorUserId);
  if (!can(subject, "platform.invitation.cancel")) {
    return { ok: false, error: TEAM_RULE_MESSAGES.forbidden };
  }
  const client = forOrganization(organizationId);
  return client.$transaction(async (tx) => {
    const cancelled = await tx.invitation.updateMany({
      where: {
        id: String(invitationId),
        status: "PENDING",
        // Only the titular handles invitations that name an administrator.
        ...(subject.isOwner === true
          ? {}
          : { NOT: { roles: { array_contains: "administrator" } } }),
      },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });
    if (cancelled.count === 0) return { ok: false, error: GONE } as const;
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "team.invitation_cancelled",
      target: { type: "invitation", id: String(invitationId) },
    });
    return { ok: true } as const;
  });
}

export type PendingInvitation = {
  id: string;
  email: string;
  roles: Role[];
  expiresAt: Date;
  expired: boolean;
  createdAt: Date;
};

/** Pending invitations of the company, newest first (USR-08). */
export async function listPendingInvitations(
  organizationId: string,
): Promise<PendingInvitation[]> {
  const rows = await forOrganization(organizationId).invitation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      roles: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    roles: Array.isArray(row.roles) ? row.roles.filter(isRole) : [],
    expiresAt: row.expiresAt,
    expired: row.expiresAt.getTime() <= now,
    createdAt: row.createdAt,
  }));
}
