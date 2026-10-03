import "server-only";

import { cache } from "react";

import { db } from "@/server";

/**
 * Who must use MFA (PLT-08B). Today: the titular (owner) of any company.
 * Company administrators (USR-01) and platform staff (MOD-09) are added
 * here when those roles exist.
 */
export const isMfaRequired = cache(async (userId: string) => {
  const owned = await db.organization.count({
    where: { ownerUserId: userId },
  });
  return owned > 0;
});
