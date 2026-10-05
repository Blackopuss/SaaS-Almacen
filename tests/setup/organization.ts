import { ensureDefaultLocation } from "@/platform/locations";
import { db } from "@/server";
import type { Prisma } from "@/server/generated/prisma/client";

/** Low-level fixtures keep their custom memberships but provision INV-13 too. */
export async function createTestOrganization(
  args: Pick<Prisma.OrganizationCreateArgs, "data">,
) {
  return db.$transaction(async (tx) => {
    const organization = await tx.organization.create(args);
    await ensureDefaultLocation(tx, organization.id);
    return organization;
  });
}
