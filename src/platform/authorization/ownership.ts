import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { db, forOrganization } from "@/server";

import { isRole, type Role } from "./catalog";

/**
 * Ownership transfer (USR-03B, founder's answer 8). Two steps:
 *
 * 1. the titular offers the company to an active member and chooses the
 *    roles they will keep afterwards (Consulta by default, never
 *    Administrador unless chosen);
 * 2. the recipient accepts, with MFA already active.
 *
 * Accepting changes Organization.ownerUserId, the previous titular's roles
 * and the offer in one transaction under a lock on the organization row:
 * there is always exactly one titular, and of two concurrent acceptances
 * only one wins. The password of the titular is asked again by the Server
 * Action that calls `offerOwnershipTransfer` (USR-08).
 */

export const OWNERSHIP_OFFER_DAYS = 7;
const DEFAULT_PREVIOUS_OWNER_ROLES: Role[] = ["viewer"];

export type OwnershipReason =
  | "not_owner"
  | "invalid_recipient"
  | "invalid_roles"
  | "not_found"
  | "expired"
  | "mfa_required";

export const OWNERSHIP_MESSAGES: Record<OwnershipReason, string> = {
  not_owner: "Solo el titular de la empresa puede hacer esto.",
  invalid_recipient:
    "Elige a una persona activa de tu equipo distinta de ti para recibir la empresa.",
  invalid_roles: "Elige roles válidos para conservar después de transferir.",
  not_found: "Esta transferencia ya no está disponible.",
  expired: "Esta transferencia venció. Pide al titular que la envíe de nuevo.",
  mfa_required:
    "Activa la verificación en dos pasos antes de aceptar la empresa.",
};

export type OfferOwnershipResult =
  | { ok: true; transferId: string; expiresAt: Date }
  | { ok: false; reason: OwnershipReason; error: string };

export type OwnershipActionResult =
  { ok: true } | { ok: false; reason: OwnershipReason; error: string };

const fail = <R extends OwnershipReason>(reason: R) =>
  ({ ok: false, reason, error: OWNERSHIP_MESSAGES[reason] }) as const;

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Locks the company row and returns its titular; null if it does not exist. */
async function lockOwner(tx: Tx, organizationId: string) {
  const rows = await tx.$queryRaw<
    { ownerUserId: string }[]
  >`SELECT ownerUserId FROM organization WHERE id = ${organizationId} FOR UPDATE`;
  return rows[0]?.ownerUserId ?? null;
}

function parseRoles(input: readonly string[] | undefined): Role[] | null {
  if (input === undefined) return DEFAULT_PREVIOUS_OWNER_ROLES;
  if (input.length === 0 || !input.every(isRole)) return null;
  return [...new Set(input)];
}

/** The titular offers the company to an active member. Replaces a pending offer. */
export async function offerOwnershipTransfer(
  organizationId: string,
  actorUserId: string,
  input: { toUserId: string; previousOwnerRoles?: readonly string[] },
): Promise<OfferOwnershipResult> {
  const roles = parseRoles(input.previousOwnerRoles);
  if (!roles) return fail("invalid_roles");
  const toUserId = String(input.toUserId);

  return db.$transaction(async (tx) => {
    const owner = await lockOwner(tx, organizationId);
    if (owner === null || owner !== actorUserId) return fail("not_owner");
    const ownMembership = await tx.membership.findFirst({
      where: { organizationId, userId: actorUserId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!ownMembership) return fail("not_owner");

    const recipient =
      toUserId === actorUserId
        ? null
        : await tx.membership.findFirst({
            where: { organizationId, userId: toUserId, status: "ACTIVE" },
            select: { id: true },
          });
    if (!recipient) return fail("invalid_recipient");

    const now = new Date();
    await tx.ownershipTransfer.updateMany({
      where: { organizationId, status: "PENDING" },
      data: { status: "CANCELLED", resolvedAt: now },
    });
    const transferId = newId();
    const expiresAt = new Date(
      now.getTime() + OWNERSHIP_OFFER_DAYS * 24 * 60 * 60 * 1000,
    );
    await tx.ownershipTransfer.create({
      data: {
        id: transferId,
        organizationId,
        fromUserId: actorUserId,
        toMembershipId: recipient.id,
        previousOwnerRoles: roles,
        expiresAt,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "ownership.transfer_offered",
      target: { type: "user", id: toUserId },
      metadata: { transferId, previousOwnerRoles: roles },
    });
    return { ok: true, transferId, expiresAt } as const;
  });
}

/** The titular withdraws the pending offer. */
export async function cancelOwnershipTransfer(
  organizationId: string,
  actorUserId: string,
): Promise<OwnershipActionResult> {
  return db.$transaction(async (tx) => {
    const owner = await lockOwner(tx, organizationId);
    if (owner === null || owner !== actorUserId) return fail("not_owner");
    const cancelled = await tx.ownershipTransfer.updateMany({
      where: { organizationId, status: "PENDING" },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });
    if (cancelled.count === 0) return fail("not_found");
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId,
      action: "ownership.transfer_cancelled",
      target: { type: "organization", id: organizationId },
    });
    return { ok: true } as const;
  });
}

/**
 * The recipient accepts: they become the titular, the previous one keeps
 * only the chosen roles. Same answer for an offer that does not exist, was
 * cancelled, was already used or belongs to someone else.
 */
export async function acceptOwnershipTransfer(
  organizationId: string,
  userId: string,
  transferId: string,
): Promise<OwnershipActionResult> {
  return db.$transaction(async (tx) => {
    const owner = await lockOwner(tx, organizationId);
    if (owner === null) return fail("not_found");

    const transfer = await tx.ownershipTransfer.findFirst({
      where: { id: String(transferId), organizationId, status: "PENDING" },
      select: {
        id: true,
        fromUserId: true,
        previousOwnerRoles: true,
        expiresAt: true,
        toMembership: {
          select: {
            id: true,
            userId: true,
            status: true,
            user: { select: { twoFactorEnabled: true } },
          },
        },
      },
    });
    if (
      !transfer ||
      transfer.toMembership.userId !== userId ||
      transfer.toMembership.status !== "ACTIVE" ||
      // The person who offered is no longer the titular.
      transfer.fromUserId !== owner
    ) {
      return fail("not_found");
    }
    if (transfer.expiresAt.getTime() <= Date.now()) return fail("expired");
    if (!transfer.toMembership.user.twoFactorEnabled) {
      return fail("mfa_required");
    }

    const stored = transfer.previousOwnerRoles;
    const roles = Array.isArray(stored) ? stored.filter(isRole) : [];
    const previous = await tx.membership.findFirst({
      where: { organizationId, userId: owner },
      select: { id: true },
    });

    await tx.organization.update({
      where: { id: organizationId },
      data: { ownerUserId: userId },
    });
    // The titular needs no roles; the previous one keeps only the chosen ones.
    await tx.membershipRole.deleteMany({
      where: {
        organizationId,
        membershipId: {
          in: [transfer.toMembership.id, ...(previous ? [previous.id] : [])],
        },
      },
    });
    if (previous && roles.length > 0) {
      await tx.membershipRole.createMany({
        data: roles.map((role) => ({
          id: newId(),
          organizationId,
          membershipId: previous.id,
          role,
        })),
      });
    }
    await tx.ownershipTransfer.update({
      where: { id: transfer.id },
      data: { status: "ACCEPTED", resolvedAt: new Date() },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "ownership.transferred",
      target: { type: "user", id: userId },
      metadata: {
        transferId: transfer.id,
        previousOwnerUserId: owner,
        previousOwnerRoles: roles,
      },
    });
    return { ok: true } as const;
  });
}

export type PendingOwnershipTransfer = {
  id: string;
  fromUserId: string;
  toUserId: string;
  previousOwnerRoles: Role[];
  expiresAt: Date;
};

/** The company's pending offer, if it has not expired. */
export async function getPendingOwnershipTransfer(
  organizationId: string,
): Promise<PendingOwnershipTransfer | null> {
  const transfer = await forOrganization(
    organizationId,
  ).ownershipTransfer.findFirst({
    where: {
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fromUserId: true,
      previousOwnerRoles: true,
      expiresAt: true,
      toMembership: { select: { userId: true } },
    },
  });
  if (!transfer) return null;
  const stored = transfer.previousOwnerRoles;
  return {
    id: transfer.id,
    fromUserId: transfer.fromUserId,
    toUserId: transfer.toMembership.userId,
    previousOwnerRoles: Array.isArray(stored) ? stored.filter(isRole) : [],
    expiresAt: transfer.expiresAt,
  };
}
