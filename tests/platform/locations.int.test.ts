import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isId, newId } from "@/lib";
import { invalidateEntitlements } from "@/platform/entitlements";
import {
  ensureDefaultLocation,
  getDefaultLocation,
  type LocationActor,
} from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

const stamp = Date.now();
let counter = 0;

async function newUser() {
  return db.user.create({
    data: {
      id: newId(),
      name: "Persona de ubicaciones",
      email: `ubicaciones.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
}

async function company(): Promise<LocationActor> {
  const owner = await newUser();
  const result = await createOrganization(owner.id, {
    name: `Ferretería de ubicaciones ${counter}`,
    timeZone: "",
  });
  if (!result.ok) throw new Error("company setup failed");
  return { organizationId: result.organizationId, userId: owner.id };
}

async function grantInventory(actor: LocationActor, expired = false) {
  await db.entitlement.create({
    data: {
      id: newId(),
      organizationId: actor.organizationId,
      kind: "MODULE",
      key: "inventory",
      validFrom: new Date(Date.now() - 120_000),
      validUntil: expired ? new Date(Date.now() - 60_000) : null,
    },
  });
  invalidateEntitlements(actor.organizationId);
}

async function defaults(actor: LocationActor) {
  return forOrganization(actor.organizationId).facility.findUniqueOrThrow({
    where: { organizationId: actor.organizationId },
    include: { locations: true },
  });
}

let actorA: LocationActor;
let actorB: LocationActor;
beforeAll(async () => {
  actorA = await company();
  actorB = await company();
  await grantInventory(actorA);
  await grantInventory(actorB);
});
afterAll(() => db.$disconnect());

describe("automatic facility and General (INV-13)", () => {
  it("creates the facility and General even before the company has a plan", async () => {
    const actor = await company();
    const facility = await defaults(actor);
    expect(isId(facility.id)).toBe(true);
    expect(facility.name).toBe("Principal");
    expect(facility.locations).toEqual([
      expect.objectContaining({
        organizationId: actor.organizationId,
        facilityId: facility.id,
        name: "General",
        isDefault: true,
      }),
    ]);
    expect(isId(facility.locations[0]!.id)).toBe(true);
    expect(await forOrganization(actor.organizationId).facility.count()).toBe(
      1,
    );
    await expect(getDefaultLocation(actor)).rejects.toMatchObject({
      code: "module_not_contracted",
    });
  });

  it("repeated provisioning preserves ids, names and timestamps", async () => {
    const actor = await company();
    const original = await defaults(actor);
    // Idempotency does not depend on the facility's display name.
    await forOrganization(actor.organizationId).facility.update({
      where: { id: original.id },
      data: { name: "Ferretería Centro" },
    });
    const before = await defaults(actor);
    await db.$transaction(async (tx) => {
      await ensureDefaultLocation(tx, actor.organizationId);
      await ensureDefaultLocation(tx, actor.organizationId);
    });
    expect(await defaults(actor)).toEqual(before);
  });

  it("concurrent first provisioning and retries create only one pair", async () => {
    // An old company that never got the initial pair (locations are never
    // deleted, so it is created without them).
    const owner = await newUser();
    const organization = await db.organization.create({
      data: {
        id: newId(),
        name: "Ferretería sin ubicaciones",
        ownerUserId: owner.id,
        memberships: { create: { id: newId(), userId: owner.id } },
      },
    });
    const actor = { organizationId: organization.id, userId: owner.id };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.$transaction((tx) =>
          ensureDefaultLocation(tx, actor.organizationId),
        ),
      ),
    );
    expect(new Set(results.map((r) => r.facility.id)).size).toBe(1);
    expect(new Set(results.map((r) => r.location.id)).size).toBe(1);
    const rows = await defaults(actor);
    expect(rows.locations).toHaveLength(1);
    expect(await forOrganization(actor.organizationId).facility.count()).toBe(
      1,
    );
  });

  it("rolls back the whole company when its provisioning transaction fails", async () => {
    const user = await newUser();
    const organizationId = newId();
    await expect(
      db.$transaction(async (tx) => {
        // Deliberately fail after provisioning; this is not a persistent fixture.
        await tx.organization.create({
          data: { id: organizationId, ownerUserId: user.id, name: "Revertida" },
        });
        await ensureDefaultLocation(tx, organizationId);
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");
    expect(await db.organization.count({ where: { id: organizationId } })).toBe(
      0,
    );
    expect(await forOrganization(organizationId).facility.count()).toBe(0);
    expect(await forOrganization(organizationId).location.count()).toBe(0);
  });

  it("refuses to provision a nonexistent company", async () => {
    await expect(
      db.$transaction((tx) => ensureDefaultLocation(tx, newId())),
    ).rejects.toMatchObject({ code: "organization_not_found" });
  });
});

describe("database constraints", () => {
  it("rejects a second default even when the application is bypassed", async () => {
    const facility = await defaults(actorA);
    await expect(db.$executeRaw`
      INSERT INTO location (id, organizationId, facilityId, name, kind, isDefault, updatedAt)
      VALUES (${newId()}, ${actorA.organizationId}, ${facility.id}, 'General', 'GENERAL', true, UTC_TIMESTAMP(3))
    `).rejects.toThrow(/Duplicate entry|unique constraint|location_tree/i);
    await expect(
      db.location.create({
        data: {
          id: newId(),
          organizationId: actorA.organizationId,
          facilityId: facility.id,
          name: "Otra predeterminada",
          kind: "GENERAL",
          isDefault: true,
        },
      }),
    ).rejects.toThrow(/location_default_check/);
    expect(
      await forOrganization(actorA.organizationId).location.count({
        where: { isDefault: true },
      }),
    ).toBe(1);
  });

  it("names at the root ignore capitals and accents; NULL defaults allow many ordinary locations", async () => {
    const facility = await defaults(actorA);
    const data = {
      organizationId: actorA.organizationId,
      facilityId: facility.id,
      kind: "AISLE" as const,
    };
    await db.location.create({
      data: { id: newId(), ...data, name: "Pasillo Á" },
    });
    await db.location.create({
      data: { id: newId(), ...data, name: "Pasillo B" },
    });
    for (const name of ["pasillo a", "PASILLO Á", "general", "Géneral"]) {
      await expect(
        db.location.create({ data: { id: newId(), ...data, name } }),
      ).rejects.toThrow(/location_tree: name repeated at the root/);
    }
    const other = await defaults(actorB);
    await expect(
      db.location.create({
        data: {
          id: newId(),
          organizationId: actorB.organizationId,
          facilityId: other.id,
          kind: "AISLE",
          name: "Pasillo Á",
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects empty names and the ambiguous false default marker", async () => {
    const facility = await defaults(actorA);
    for (const name of ["", "   "]) {
      await expect(
        db.facility.update({ where: { id: facility.id }, data: { name } }),
      ).rejects.toThrow(/facility_name_check/);
      await expect(
        db.location.create({
          data: {
            id: newId(),
            organizationId: actorA.organizationId,
            facilityId: facility.id,
            kind: "ZONE",
            name,
          },
        }),
      ).rejects.toThrow(/location_name_check/);
    }
    await expect(
      db.location.create({
        data: {
          id: newId(),
          organizationId: actorA.organizationId,
          facilityId: facility.id,
          name: "False",
          kind: "ZONE",
          isDefault: false,
        },
      }),
    ).rejects.toThrow(/location_default_check/);
  });

  it("rejects another facility in v1 and a location pointing to another company", async () => {
    const facility = await defaults(actorB);
    await expect(
      db.facility.create({
        data: {
          id: newId(),
          organizationId: actorA.organizationId,
          name: "Otra",
        },
      }),
    ).rejects.toThrow(/Unique constraint|facility_organizationId_key/);
    await expect(db.$executeRaw`
      INSERT INTO location (id, organizationId, facilityId, name, kind, updatedAt)
      VALUES (${newId()}, ${actorA.organizationId}, ${facility.id}, 'Ajena', 'ZONE', UTC_TIMESTAMP(3))
    `).rejects.toThrow(/foreign key/i);
    const own = (await defaults(actorA)).locations.find(
      (row) => row.isDefault,
    )!;
    await expect(
      db.location.update({
        where: { id: own.id },
        data: { facilityId: facility.id },
      }),
    ).rejects.toThrow();
  });
});

describe("authorized company-scoped reads", () => {
  it("returns the persisted facility and General, never the other company's rows", async () => {
    const own = await getDefaultLocation(actorA);
    const theirs = await getDefaultLocation(actorB);
    expect(own).toMatchObject({
      name: "General",
      facility: { name: "Principal" },
    });
    expect(own!.id).not.toBe(theirs!.id);
    expect(
      await forOrganization(actorA.organizationId).location.findFirst({
        where: { id: theirs!.id },
      }),
    ).toBeNull();
    expect(
      await forOrganization(actorA.organizationId).facility.findFirst({
        where: { id: theirs!.facility.id },
      }),
    ).toBeNull();
    await expect(
      getDefaultLocation({ ...actorA, organizationId: actorB.organizationId }),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("allows Consulta and Comprador to read even with an expired plan", async () => {
    const actor = await company();
    await grantInventory(actor, true);
    for (const role of ["viewer", "buyer"]) {
      const user = await newUser();
      const membership = await db.membership.create({
        data: {
          id: newId(),
          organizationId: actor.organizationId,
          userId: user.id,
        },
      });
      await db.membershipRole.create({
        data: {
          id: newId(),
          organizationId: actor.organizationId,
          membershipId: membership.id,
          role,
        },
      });
      await expect(
        getDefaultLocation({ ...actor, userId: user.id }),
      ).resolves.toMatchObject({ name: "General" });
      await db.membership.update({
        where: { id: membership.id },
        data: { status: "DISABLED" },
      });
      await expect(
        getDefaultLocation({ ...actor, userId: user.id }),
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
  });
});
