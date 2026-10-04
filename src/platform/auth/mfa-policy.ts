import "server-only";

import { cache } from "react";

import { db } from "@/server";

/**
 * Who must use MFA (PLT-08B, USR-01): the titular of any company and every
 * administrator with an active membership, and platform staff (MOD-09).
 */
export const isMfaRequired = cache(async (userId: string) => {
  const [owned, administrator, staff] = await Promise.all([
    db.organization.count({ where: { ownerUserId: userId } }),
    db.membershipRole.count({
      where: {
        role: "administrator",
        membership: { userId, status: "ACTIVE" },
      },
    }),
    db.platformStaff.count({ where: { userId, disabledAt: null } }),
  ]);
  return owned > 0 || administrator > 0 || staff > 0;
});
