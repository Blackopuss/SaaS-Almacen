import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import {
  blockedFor,
  clientIp,
  insertInvitedAccount,
  prepareInvitedAccount,
  recordAttempt,
  throttleKeys,
  tooManyAttemptsMessage,
  type InvitedAccountField,
} from "@/platform/auth";
import { db } from "@/server";

import { isRole, type Role } from "./catalog";
import { hashInvitationToken } from "./invitations";

/**
 * Accepting an invitation (USR-05). The token of the link is the proof:
 * whoever holds it controls the invited mailbox. Two ways in:
 *
 * - someone who already has an account signs in with the invited email and
 *   accepts;
 * - someone new chooses a name and a password: the account (email already
 *   confirmed by the link) and the membership are created together.
 *
 * The invitation row is locked while it is used, so a link works once even
 * with simultaneous requests. Invalid, expired, cancelled and used links
 * all look the same.
 */

export type InvitationPreview = {
  organizationName: string;
  email: string;
  roles: Role[];
  /** The invited email already has an account. */
  hasAccount: boolean;
};

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

type LockedInvitation = {
  id: string;
  organizationId: string;
  email: string;
  roles: Role[];
};

const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

async function findUsable(
  client: Tx | typeof db,
  token: string,
  lock: boolean,
): Promise<LockedInvitation | null> {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const tokenHash = hashInvitationToken(token);
  if (lock) {
    await client.$queryRaw`SELECT id FROM invitation WHERE tokenHash = ${tokenHash} FOR UPDATE`;
  }
  const invitation = await client.invitation.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      organizationId: true,
      email: true,
      roles: true,
      status: true,
      expiresAt: true,
    },
  });
  if (
    !invitation ||
    invitation.status !== "PENDING" ||
    invitation.expiresAt.getTime() <= Date.now()
  ) {
    return null;
  }
  const roles = Array.isArray(invitation.roles)
    ? invitation.roles.filter(isRole)
    : [];
  if (roles.length === 0) return null;
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    roles,
  };
}

/** What the invitation offers, or null when the link cannot be used. */
export async function previewInvitation(
  token: string,
): Promise<InvitationPreview | null> {
  const invitation = await findUsable(db, token, false);
  if (!invitation) return null;
  const [organization, account] = await Promise.all([
    db.organization.findUnique({
      where: { id: invitation.organizationId },
      select: { name: true },
    }),
    db.user.count({ where: { email: invitation.email } }),
  ]);
  if (!organization) return null;
  return {
    organizationName: organization.name,
    email: invitation.email,
    roles: invitation.roles,
    hasAccount: account > 0,
  };
}

/** Membership with the invited roles + invitation used + audit, in `tx`. */
async function join(tx: Tx, invitation: LockedInvitation, userId: string) {
  const membershipId = newId();
  await tx.membership.create({
    data: {
      id: membershipId,
      organizationId: invitation.organizationId,
      userId,
    },
  });
  await tx.membershipRole.createMany({
    data: invitation.roles.map((role) => ({
      id: newId(),
      organizationId: invitation.organizationId,
      membershipId,
      role,
    })),
  });
  await tx.invitation.update({
    where: { id: invitation.id },
    data: { status: "ACCEPTED", resolvedAt: new Date() },
  });
  await recordAuditEvent(tx, {
    organizationId: invitation.organizationId,
    actorUserId: userId,
    action: "team.invitation_accepted",
    target: { type: "invitation", id: invitation.id },
    metadata: { roles: invitation.roles, membershipId },
  });
}

export type AcceptInvitationReason =
  "invalid" | "wrong_account" | "already_member";

export const ACCEPT_INVITATION_MESSAGES: Record<
  AcceptInvitationReason,
  string
> = {
  invalid: "Esta invitación ya no está disponible.",
  wrong_account:
    "Esta invitación es para otro correo. Cierra sesión y entra con el correo invitado.",
  already_member: "Ya eres parte de esta empresa.",
};

export type AcceptInvitationResult =
  | { ok: true; organizationId: string }
  | { ok: false; reason: AcceptInvitationReason; error: string };

const refuse = (reason: AcceptInvitationReason) =>
  ({ ok: false, reason, error: ACCEPT_INVITATION_MESSAGES[reason] }) as const;

/** A signed-in person accepts the invitation sent to their email. */
export async function acceptInvitation(
  userId: string,
  token: string,
): Promise<AcceptInvitationResult> {
  return db.$transaction(async (tx) => {
    const invitation = await findUsable(tx, token, true);
    if (!invitation) return refuse("invalid");
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true },
    });
    if (
      !user ||
      !user.emailVerified ||
      user.email.toLowerCase() !== invitation.email
    ) {
      return refuse("wrong_account");
    }
    const existing = await tx.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: invitation.organizationId,
          userId,
        },
      },
      select: { status: true },
    });
    // A disabled member comes back only when the company reactivates them.
    if (existing) {
      return refuse(
        existing.status === "ACTIVE" ? "already_member" : "invalid",
      );
    }
    await join(tx, invitation, userId);
    return { ok: true, organizationId: invitation.organizationId } as const;
  });
}

export type AcceptAsNewUserResult =
  | { ok: true; organizationId: string; email: string }
  | {
      ok: false;
      reason: "invalid" | "has_account" | "throttled";
      error: string;
    }
  | {
      ok: false;
      reason: "fields";
      fieldErrors: Partial<Record<InvitedAccountField, string>>;
    };

const HAS_ACCOUNT =
  "Este correo ya tiene cuenta. Inicia sesión para aceptar la invitación.";

/** Someone without an account creates it and joins, in one transaction. */
export async function acceptInvitationAsNewUser(
  token: string,
  input: { name: string; password: string },
  headers: Headers,
): Promise<AcceptAsNewUserResult> {
  const key = [throttleKeys.inviteTokenIp(clientIp(headers))];
  const wait = await blockedFor(key);
  if (wait > 0) {
    return {
      ok: false,
      reason: "throttled",
      error: tooManyAttemptsMessage(wait),
    };
  }
  await recordAttempt(key);

  // Check the link before the (slow) password hash.
  if (!(await findUsable(db, token, false))) {
    return {
      ok: false,
      reason: "invalid",
      error: ACCEPT_INVITATION_MESSAGES.invalid,
    };
  }
  const account = await prepareInvitedAccount(input);
  if (!account.ok) {
    return { ok: false, reason: "fields", fieldErrors: account.fieldErrors };
  }

  try {
    return await db.$transaction(async (tx) => {
      const invitation = await findUsable(tx, token, true);
      if (!invitation) {
        return {
          ok: false,
          reason: "invalid",
          error: ACCEPT_INVITATION_MESSAGES.invalid,
        } as const;
      }
      const taken = await tx.user.count({ where: { email: invitation.email } });
      if (taken > 0) {
        return {
          ok: false,
          reason: "has_account",
          error: HAS_ACCOUNT,
        } as const;
      }
      const userId = await insertInvitedAccount(tx, {
        name: account.name,
        email: invitation.email,
        passwordHash: account.passwordHash,
      });
      await join(tx, invitation, userId);
      return {
        ok: true,
        organizationId: invitation.organizationId,
        email: invitation.email,
      } as const;
    });
  } catch (error) {
    // Two requests created the same email at once: the other one won.
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, reason: "has_account", error: HAS_ACCOUNT };
    }
    throw error;
  }
}
