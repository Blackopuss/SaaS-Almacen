import "server-only";

import { getFreshEntitlements, readLimit } from "@/platform/entitlements";
import { db, forOrganization } from "@/server";

/**
 * Seats (MOD-08). The plan includes a number of people (limit "users"). A
 * seat is taken by every active member — the titular included, whatever
 * their roles — and by every pending invitation that has not expired.
 *
 * Seats are counted under a lock on the company row instead of kept in a
 * counter: invitations expire by themselves, so a counter would drift.
 * Everything that adds a seat (inviting, renewing an expired invitation,
 * reactivating a member) locks the company first, so with 4 of 5 seats two
 * simultaneous invitations allow exactly one.
 */

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export class SeatLimitError extends Error {
  constructor(
    /** Null when the company has no "users" limit granted. */
    readonly limit: number | null,
    readonly taken: number,
  ) {
    super(seatLimitMessage(limit));
    this.name = "SeatLimitError";
  }
}

export function seatLimitMessage(limit: number | null): string {
  if (limit === null) {
    return "Tu empresa todavía no tiene un plan con usuarios. Pide que lo activen antes de sumar personas.";
  }
  return `Tu plan incluye ${limit} ${limit === 1 ? "usuario" : "usuarios"} y ya están ocupados (las invitaciones pendientes cuentan). Cancela una invitación, desactiva a alguien o agrega usuarios a tu plan.`;
}

/** Locks the company row for the rest of the transaction. False if it does not exist. */
export async function lockOrganization(
  tx: Tx,
  organizationId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
  return rows.length === 1;
}

type SeatCounter = {
  membership: { count(args: { where: object }): PromiseLike<number> };
  invitation: { count(args: { where: object }): PromiseLike<number> };
};

async function countSeats(client: SeatCounter, organizationId: string) {
  const [members, pending] = await Promise.all([
    client.membership.count({ where: { organizationId, status: "ACTIVE" } }),
    client.invitation.count({
      where: {
        organizationId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    }),
  ]);
  return { members, pending };
}

/**
 * Throws SeatLimitError unless one more seat fits. Call it inside the
 * transaction that adds the seat, after `lockOrganization`.
 */
export async function assertSeatAvailable(
  tx: Tx,
  organizationId: string,
): Promise<void> {
  // Same connection as the lock: nothing here waits for another one.
  const limit = await readLimit(tx, organizationId, "users");
  const { members, pending } = await countSeats(tx, organizationId);
  const taken = members + pending;
  if (limit === null || taken + 1 > limit) {
    throw new SeatLimitError(limit, taken);
  }
}

export type SeatUsage = {
  /** Null when the company has no "users" limit granted. */
  limit: number | null;
  members: number;
  pendingInvitations: number;
  /** Seats left; 0 without a limit or when over it. */
  available: number;
};

/** Seats in use, for screens («Usuarios: 4 de 5»). */
export async function getSeatUsage(organizationId: string): Promise<SeatUsage> {
  const [entitlements, { members, pending }] = await Promise.all([
    getFreshEntitlements(organizationId),
    countSeats(forOrganization(organizationId), organizationId),
  ]);
  const limit = entitlements.limit("users");
  return {
    limit,
    members,
    pendingInvitations: pending,
    available: limit === null ? 0 : Math.max(0, limit - members - pending),
  };
}
