import { newId } from "@/lib";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

/**
 * Gives a test company a plan with room for people (limit "users"), so
 * invitations and reactivations are not stopped by the seat limit (MOD-08)
 * unless the test is about that limit.
 */
export async function grantSeats(
  organizationId: string,
  seats = 100,
): Promise<void> {
  await db.entitlement.upsert({
    where: {
      organizationId_kind_key: { organizationId, kind: "LIMIT", key: "users" },
    },
    update: { value: seats },
    create: {
      id: newId(),
      organizationId,
      kind: "LIMIT",
      key: "users",
      value: seats,
      validFrom: new Date(Date.now() - 60_000),
    },
  });
  invalidateEntitlements(organizationId);
}
