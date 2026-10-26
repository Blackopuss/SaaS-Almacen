import "server-only";

import { db, forOrganization } from "@/server";

/**
 * Support access (PIL-12): platform staff may look into a company only
 * while its titular keeps an access open (`support_access`), and only to
 * read. Checked on every request, so closing it or reaching its time ends
 * it at once. Nothing here grants anything to people who are not staff.
 */

export type SupportWindow = { id: string; until: Date };

/** The open access of a company, if any (its latest end wins). */
export async function openSupportAccess(
  organizationId: string,
): Promise<SupportWindow | null> {
  const row = await forOrganization(organizationId).supportAccess.findFirst({
    where: { revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: "desc" },
    select: { id: true, expiresAt: true },
  });
  return row ? { id: row.id, until: row.expiresAt } : null;
}

/** Whether this person may look into the company as support right now. */
export async function supportWindowFor(
  organizationId: string,
  userId: string,
): Promise<SupportWindow | null> {
  const staff = await db.platformStaff.count({
    where: { userId, disabledAt: null },
  });
  if (staff === 0) return null;
  return openSupportAccess(organizationId);
}
