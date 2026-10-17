import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { db, forOrganization } from "@/server";

import { isRole, type Role } from "./catalog";
import { knownRoles } from "./policy";
import { SeatLimitError, assertSeatAvailable } from "./seats";
import {
  TEAM_RULE_MESSAGES,
  checkTeamChange,
  type TeamChange,
  type TeamPerson,
  type TeamRuleReason,
} from "./team-rules";

/**
 * Team changes (USR-06, USR-07). Every change locks the company row and
 * reads both people again inside the transaction, so a decision is never
 * taken on stale roles (e.g. while the ownership is being transferred).
 * A person holds one membership per company whatever their roles: several
 * roles join their permissions and take one seat.
 */

export type TeamActionReason =
  TeamRuleReason | "not_found" | "unchanged" | "no_seats";

export type TeamActionResult =
  { ok: true } | { ok: false; reason: TeamActionReason; error: string };

const MESSAGES: Record<TeamActionReason, string> = {
  ...TEAM_RULE_MESSAGES,
  not_found: "Esta persona no está en tu equipo.",
  unchanged: "No hay cambios que guardar.",
  no_seats: "Tu plan no tiene lugares disponibles.",
};

const fail = (reason: TeamActionReason) =>
  ({ ok: false, reason, error: MESSAGES[reason] }) as const;

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

type LoadedMember = TeamPerson & {
  membershipId: string;
  status: "ACTIVE" | "DISABLED";
};

async function memberIn(
  tx: Tx,
  organizationId: string,
  ownerUserId: string,
  userId: string,
): Promise<LoadedMember | null> {
  const membership = await tx.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { id: true, status: true, roles: { select: { role: true } } },
  });
  if (!membership) return null;
  return {
    userId,
    membershipId: membership.id,
    status: membership.status,
    isOwner: ownerUserId === userId,
    roles: membership.roles.map((r) => r.role),
  };
}

/**
 * Runs `change` on `targetUserId` if the rules allow `actorUserId` to do it.
 * The actor must be an active member; the target must belong to the company.
 */
async function withTeamChange(
  organizationId: string,
  actorUserId: string,
  targetUserId: string,
  change: TeamChange,
  apply: (
    tx: Tx,
    target: LoadedMember,
  ) => Promise<TeamActionResult | undefined>,
): Promise<TeamActionResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { ownerUserId: string }[]
    >`SELECT ownerUserId FROM organization WHERE id = ${organizationId} FOR UPDATE`;
    const owner = rows[0]?.ownerUserId;
    if (!owner) return fail("forbidden");
    const actor = await memberIn(tx, organizationId, owner, actorUserId);
    if (!actor || actor.status !== "ACTIVE") return fail("forbidden");
    const target = await memberIn(
      tx,
      organizationId,
      owner,
      String(targetUserId),
    );
    // Asked before looking at the target, so people without the permission
    // learn nothing about who is in the company.
    const rule = checkTeamChange(
      actor,
      target ?? { userId: String(targetUserId), isOwner: false, roles: [] },
      change,
    );
    if (!rule.ok && rule.reason === "forbidden") return fail("forbidden");
    if (!target) return fail("not_found");
    if (!rule.ok) return fail(rule.reason);
    return (await apply(tx, target)) ?? ({ ok: true } as const);
  });
}

/** Replaces the roles of a member (USR-06). Several roles join their permissions. */
export async function assignRoles(
  organizationId: string,
  actorUserId: string,
  input: { userId: string; roles: readonly string[] },
): Promise<TeamActionResult> {
  return withTeamChange(
    organizationId,
    actorUserId,
    input.userId,
    { kind: "assign_roles", roles: input.roles },
    async (tx, target) => {
      const next = knownRoles(input.roles);
      const previous = knownRoles(target.roles);
      if (next.join() === previous.join()) return fail("unchanged");
      await tx.membershipRole.deleteMany({
        where: { organizationId, membershipId: target.membershipId },
      });
      await tx.membershipRole.createMany({
        data: next.map((role) => ({
          id: newId(),
          organizationId,
          membershipId: target.membershipId,
          role,
        })),
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "team.roles_changed",
        target: { type: "user", id: target.userId },
        metadata: { from: previous, to: next },
      });
      return undefined;
    },
  );
}

/**
 * Disables a member (USR-07): they lose access at once and every session
 * of theirs is closed. The membership and the account stay, so whatever
 * they did keeps their name in the history.
 */
export async function disableMember(
  organizationId: string,
  actorUserId: string,
  input: { userId: string; reason?: string },
): Promise<TeamActionResult> {
  return withTeamChange(
    organizationId,
    actorUserId,
    input.userId,
    { kind: "disable" },
    async (tx, target) => {
      if (target.status === "DISABLED") return fail("unchanged");
      await tx.membership.update({
        where: { id: target.membershipId },
        data: { status: "DISABLED" },
      });
      // An offer to hand them the company dies with their access.
      await tx.ownershipTransfer.updateMany({
        where: {
          organizationId,
          toMembershipId: target.membershipId,
          status: "PENDING",
        },
        data: { status: "CANCELLED", resolvedAt: new Date() },
      });
      const closed = await tx.session.deleteMany({
        where: { userId: target.userId },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "team.member_disabled",
        target: { type: "user", id: target.userId },
        reason: input.reason,
        metadata: {
          roles: knownRoles(target.roles),
          sessionsClosed: closed.count,
        },
      });
      return undefined;
    },
  );
}

/** Gives a disabled member their access back, with the roles they had. */
export async function reactivateMember(
  organizationId: string,
  actorUserId: string,
  input: { userId: string },
): Promise<TeamActionResult> {
  return withTeamChange(
    organizationId,
    actorUserId,
    input.userId,
    { kind: "disable" },
    async (tx, target) => {
      if (target.status === "ACTIVE") return fail("unchanged");
      // Coming back takes a seat of the plan again (MOD-08).
      try {
        await assertSeatAvailable(tx, organizationId);
      } catch (error) {
        if (error instanceof SeatLimitError) {
          return { ok: false, reason: "no_seats", error: error.message };
        }
        throw error;
      }
      await tx.membership.update({
        where: { id: target.membershipId },
        data: { status: "ACTIVE" },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "team.member_reactivated",
        target: { type: "user", id: target.userId },
        metadata: { roles: knownRoles(target.roles) },
      });
      return undefined;
    },
  );
}

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  isOwner: boolean;
  roles: Role[];
  joinedAt: Date;
};

/** Everyone in the company: titular first, then by name (USR-08). */
export async function listTeamMembers(
  organizationId: string,
): Promise<TeamMember[]> {
  const [organization, memberships] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { ownerUserId: true },
    }),
    forOrganization(organizationId).membership.findMany({
      select: {
        userId: true,
        status: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
        roles: { select: { role: true } },
      },
    }),
  ]);
  return memberships
    .map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      status: m.status,
      isOwner: organization?.ownerUserId === m.userId,
      roles: knownRoles(m.roles.map((r) => r.role).filter(isRole)),
      joinedAt: m.createdAt,
    }))
    .sort(
      (a, b) =>
        Number(b.isOwner) - Number(a.isOwner) ||
        a.name.localeCompare(b.name, "es"),
    );
}

/**
 * Seats in use: one per active member, whatever their roles. Pending
 * invitations are added by the plan quota (MOD-08).
 */
export async function countSeatsInUse(organizationId: string): Promise<number> {
  return forOrganization(organizationId).membership.count({
    where: { status: "ACTIVE" },
  });
}
