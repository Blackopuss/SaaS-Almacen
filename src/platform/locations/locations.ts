import "server-only";

import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

export type LocationActor = { organizationId: string; userId: string };

/** Read-only lookup; the actor always comes from the active session. */
export async function getDefaultLocation(actor: LocationActor) {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.location.read",
  );
  return forOrganization(actor.organizationId).location.findFirst({
    where: { isDefault: true },
    select: {
      id: true,
      name: true,
      isDefault: true,
      facility: { select: { id: true, name: true } },
    },
  });
}
