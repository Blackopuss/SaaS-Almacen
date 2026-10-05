import "server-only";

import { newId, NotFoundError } from "@/lib";
import type { TransactionClient } from "@/server";

type LocationTransaction = Pick<
  TransactionClient,
  "$queryRaw" | "facility" | "location"
>;

/**
 * System provisioning, not a user-facing write operation. Call only with
 * the transaction that creates the company (or repairs its initial data).
 * It must support the organization row lock; no connection is opened here.
 * All reads/writes carry the caller's trusted organizationId explicitly.
 */
export async function ensureDefaultLocation(
  tx: LocationTransaction,
  organizationId: string,
) {
  // Serializes concurrent/repeated provisioning, even before a facility exists.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new NotFoundError("organization_not_found", "La empresa no existe.");
  }

  // The unique company key preserves identity even if the name changes later.
  const facility = await tx.facility.upsert({
    where: { organizationId },
    update: {},
    create: { id: newId(), organizationId, name: "Principal" },
  });
  const location = await tx.location.upsert({
    where: {
      organizationId_facilityId_isDefault: {
        organizationId,
        facilityId: facility.id,
        isDefault: true,
      },
    },
    update: {},
    create: {
      id: newId(),
      organizationId,
      facilityId: facility.id,
      name: "General",
      isDefault: true,
    },
  });
  return { facility, location };
}
