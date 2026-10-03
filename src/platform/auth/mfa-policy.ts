import "server-only";

import { cache } from "react";

import { db } from "@/server";

/**
 * Who must use MFA (PLT-08B, USR-01): the titular of any company and every
 * administrator with an active membership. Platform staff (MOD-09) is
 * added here when that role exists.
 */
export const isMfaRequired = cache(async (userId: string) => {
  const [owned, administrator] = await Promise.all([
    db.organization.count({ where: { ownerUserId: userId } }),
    db.membershipRole.count({
      where: {
        role: "administrator",
        membership: { userId, status: "ACTIVE" },
      },
    }),
  ]);
  return owned > 0 || administrator > 0;
});
