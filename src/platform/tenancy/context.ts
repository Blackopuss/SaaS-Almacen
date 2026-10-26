import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { requireSession, type CurrentUser } from "@/platform/auth";
import { db } from "@/server";

import { CREATE_ORGANIZATION_PATH } from "./organizations";
import { supportWindowFor } from "./support";

/**
 * Active company (PLT-11). Each session works in one company, stored on
 * the session row in the database (never in a cookie the browser could
 * change). Every request re-checks that the person still has an active
 * membership there; if not, it falls back to another company of theirs or
 * to /crear-empresa. Business code receives `organizationId` only from here.
 */

export type ActiveOrganization = {
  id: string;
  name: string;
  timeZone: string;
  currency: string;
  /** The person is the company's titular (Organization.ownerUserId). */
  isOwner: boolean;
  /**
   * Platform support looking into the company with its titular's leave
   * (PIL-12): read-only, until this moment. Null for its members.
   */
  supportUntil: Date | null;
};

export type OrganizationContext = {
  user: CurrentUser;
  sessionId: string;
  mfaEnabled: boolean;
  organization: ActiveOrganization;
};

export type MyOrganization = { id: string; name: string };

/** Companies where the person is an active member, oldest first. */
export async function listMyOrganizations(
  userId: string,
): Promise<MyOrganization[]> {
  const memberships = await db.membership.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { id: true, name: true } } },
  });
  return memberships.map((m) => m.organization);
}

/**
 * Resolves the session's company: the stored one if the membership is
 * still active, otherwise the oldest active membership (saved back to the
 * session). Null when the person belongs to no company.
 */
export async function resolveActiveOrganization(
  userId: string,
  sessionId: string,
): Promise<ActiveOrganization | null> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { userId: true, activeOrganizationId: true },
  });
  if (!session || session.userId !== userId) return null;

  const select = {
    organization: {
      select: {
        id: true,
        name: true,
        timeZone: true,
        currency: true,
        ownerUserId: true,
      },
    },
  } as const;

  let membership = session.activeOrganizationId
    ? await db.membership.findFirst({
        where: {
          userId,
          organizationId: session.activeOrganizationId,
          status: "ACTIVE",
        },
        select,
      })
    : null;

  // Support is in a company where it has no membership, while the
  // titular's access stays open (PIL-12).
  if (!membership && session.activeOrganizationId) {
    const window = await supportWindowFor(session.activeOrganizationId, userId);
    if (window) {
      const company = await db.organization.findUnique({
        where: { id: session.activeOrganizationId },
        select: { id: true, name: true, timeZone: true, currency: true },
      });
      if (company) {
        return { ...company, isOwner: false, supportUntil: window.until };
      }
    }
  }

  if (!membership) {
    membership = await db.membership.findFirst({
      where: { userId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select,
    });
    const fallback = membership?.organization.id ?? null;
    if (fallback !== session.activeOrganizationId) {
      await db.session.update({
        where: { id: sessionId },
        data: { activeOrganizationId: fallback },
      });
    }
  }
  if (!membership) return null;

  const { ownerUserId, ...organization } = membership.organization;
  return {
    ...organization,
    isOwner: ownerUserId === userId,
    supportUntil: null,
  };
}

/**
 * Guard for every business screen and action: valid session (and MFA when
 * required) plus an active company. People without one are sent to create
 * it. Cached per request.
 */
export const requireOrganizationContext = cache(
  async (): Promise<OrganizationContext> => {
    const session = await requireSession();
    const organization = await resolveActiveOrganization(
      session.user.id,
      session.sessionId,
    );
    if (!organization) redirect(CREATE_ORGANIZATION_PATH);
    return { ...session, organization };
  },
);

export type SwitchOrganizationResult =
  { ok: true } | { ok: false; error: string };

/**
 * Makes another company the session's active one, only if the person is an
 * active member there. The same answer for "no such company" and "not a
 * member", so identifiers of other companies reveal nothing.
 */
export async function switchOrganization(
  userId: string,
  sessionId: string,
  organizationId: string,
): Promise<SwitchOrganizationResult> {
  const membership = await db.membership.findFirst({
    where: { userId, organizationId: String(organizationId), status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) {
    return { ok: false, error: "No tienes acceso a esa empresa." };
  }
  const updated = await db.session.updateMany({
    where: { id: sessionId, userId },
    data: { activeOrganizationId: organizationId },
  });
  return updated.count === 1
    ? { ok: true }
    : {
        ok: false,
        error: "Tu sesión ya no es válida. Inicia sesión de nuevo.",
      };
}
