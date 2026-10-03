import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { db } from "@/server";

// PLT-01: tenancy schema constraints with two test organizations.

const suffix = Date.now();
const ana = { id: newId(), name: "Ana", email: `ana.${suffix}@example.test` };
const beto = {
  id: newId(),
  name: "Beto",
  email: `beto.${suffix}@example.test`,
};
const esperanza = { id: newId(), name: "Ferretería La Esperanza" };
const tornillo = { id: newId(), name: "Ferretería El Tornillo" };

beforeAll(async () => {
  await db.user.createMany({ data: [ana, beto] });
  await db.organization.create({
    data: {
      ...esperanza,
      ownerUserId: ana.id,
      memberships: { create: { id: newId(), userId: ana.id } },
    },
  });
  await db.organization.create({
    data: {
      ...tornillo,
      ownerUserId: beto.id,
      memberships: { create: { id: newId(), userId: beto.id } },
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("organization and membership schema", () => {
  it("creates two organizations with Mexican defaults", async () => {
    const orgs = await db.organization.findMany({
      where: { id: { in: [esperanza.id, tornillo.id] } },
      include: { memberships: true },
      orderBy: { name: "asc" },
    });
    expect(orgs.map((o) => o.name)).toEqual([
      "Ferretería El Tornillo",
      "Ferretería La Esperanza",
    ]);
    for (const org of orgs) {
      expect(org.timeZone).toBe("America/Mexico_City");
      expect(org.currency).toBe("MXN");
      expect(org.memberships).toHaveLength(1);
      expect(org.memberships[0]!.userId).toBe(org.ownerUserId);
      expect(org.memberships[0]!.status).toBe("ACTIVE");
    }
  });

  it("lets one user belong to several organizations", async () => {
    await db.membership.create({
      data: { id: newId(), organizationId: tornillo.id, userId: ana.id },
    });
    const memberships = await db.membership.findMany({
      where: { userId: ana.id },
    });
    expect(memberships.map((m) => m.organizationId).sort()).toEqual(
      [esperanza.id, tornillo.id].sort(),
    );
  });

  it("rejects a duplicate membership", async () => {
    await expect(
      db.membership.create({
        data: { id: newId(), organizationId: esperanza.id, userId: ana.id },
      }),
    ).rejects.toThrow();
  });

  it("rejects a membership to a missing organization or user", async () => {
    await expect(
      db.membership.create({
        data: { id: newId(), organizationId: newId(), userId: ana.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.membership.create({
        data: { id: newId(), organizationId: esperanza.id, userId: newId() },
      }),
    ).rejects.toThrow();
  });

  it("does not cascade deletes across tenants", async () => {
    await expect(db.user.delete({ where: { id: beto.id } })).rejects.toThrow();
    await expect(
      db.organization.delete({ where: { id: esperanza.id } }),
    ).rejects.toThrow();
    expect(
      await db.organization.count({
        where: { id: { in: [esperanza.id, tornillo.id] } },
      }),
    ).toBe(2);
  });
});
