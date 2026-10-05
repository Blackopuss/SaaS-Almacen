import { createTestOrganization } from "../setup/organization";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { TenantScopeError, db, forOrganization } from "@/server";

// PLT-12: business queries need a company context and only ever see or
// change rows of that company. Membership is today's company-scoped table.

const stamp = Date.now();
const users = {
  ana: newId(),
  beto: newId(),
  carla: newId(),
};
const orgA = newId();
const orgB = newId();
let memberOfB = "";

beforeAll(async () => {
  await db.user.createMany({
    data: Object.entries(users).map(([name, id]) => ({
      id,
      name,
      email: `${name}.tenant.${stamp}@example.test`,
    })),
  });
  await createTestOrganization({
    data: {
      id: orgA,
      name: "Empresa A",
      ownerUserId: users.ana,
      memberships: { create: { id: newId(), userId: users.ana } },
    },
  });
  await createTestOrganization({
    data: {
      id: orgB,
      name: "Empresa B",
      ownerUserId: users.beto,
      memberships: { create: { id: newId(), userId: users.beto } },
    },
  });
  memberOfB = (
    await db.membership.findFirstOrThrow({ where: { organizationId: orgB } })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("without a company context", () => {
  it("refuses to build a client", () => {
    expect(() => forOrganization("")).toThrow(TenantScopeError);
    expect(() => forOrganization(undefined as unknown as string)).toThrow(
      "Consulta de negocio sin contexto de empresa.",
    );
  });
});

describe("reads", () => {
  it("only return rows of the active company", async () => {
    const rows = await forOrganization(orgA).membership.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgA)).toBe(true);
  });

  it("do not find another company's row even by its id", async () => {
    const scoped = forOrganization(orgA);
    expect(
      await scoped.membership.findUnique({ where: { id: memberOfB } }),
    ).toBeNull();
    expect(
      await scoped.membership.findFirst({ where: { id: memberOfB } }),
    ).toBeNull();
    expect(await scoped.membership.count({ where: { id: memberOfB } })).toBe(0);
  });

  it("reject a filter that asks for another company", async () => {
    await expect(
      forOrganization(orgA).membership.findMany({
        where: { organizationId: orgB },
      }),
    ).rejects.toThrow(TenantScopeError);
  });
});

describe("writes", () => {
  it("create rows in the active company", async () => {
    const row = await forOrganization(orgA).membership.create({
      data: { id: newId(), organizationId: orgA, userId: users.carla },
    });
    expect(row.organizationId).toBe(orgA);
  });

  it("refuse creating rows for another company", async () => {
    await expect(
      forOrganization(orgA).membership.create({
        data: { id: newId(), userId: users.carla, organizationId: orgB },
      }),
    ).rejects.toThrow(TenantScopeError);
    await expect(
      forOrganization(orgA).membership.create({
        data: {
          id: newId(),
          user: { connect: { id: users.carla } },
          organization: { connect: { id: orgB } },
        },
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("cannot change or delete another company's row", async () => {
    const scoped = forOrganization(orgA);
    await expect(
      scoped.membership.update({
        where: { id: memberOfB },
        data: { status: "DISABLED" },
      }),
    ).rejects.toThrow();
    expect(
      (
        await scoped.membership.updateMany({
          where: { id: memberOfB },
          data: { status: "DISABLED" },
        })
      ).count,
    ).toBe(0);
    await expect(
      scoped.membership.delete({ where: { id: memberOfB } }),
    ).rejects.toThrow();
    expect(
      (await scoped.membership.deleteMany({ where: { id: memberOfB } })).count,
    ).toBe(0);
    const untouched = await db.membership.findUniqueOrThrow({
      where: { id: memberOfB },
    });
    expect(untouched.status).toBe("ACTIVE");
  });

  it("cannot move a row to another company", async () => {
    const own = await forOrganization(orgA).membership.findFirstOrThrow({
      where: { userId: users.ana },
    });
    await expect(
      forOrganization(orgA).membership.update({
        where: { id: own.id },
        data: { organizationId: orgB },
      }),
    ).rejects.toThrow(TenantScopeError);
  });
});

describe("escape hatches are closed", () => {
  it("refuses models without organizationId", async () => {
    const scoped = forOrganization(orgA);
    await expect(scoped.user.findMany()).rejects.toThrow(TenantScopeError);
    await expect(scoped.organization.findMany()).rejects.toThrow(
      TenantScopeError,
    );
  });

  it("refuses raw SQL, also inside transactions", async () => {
    const scoped = forOrganization(orgA);
    expect(() => scoped.$queryRawUnsafe("SELECT 1")).toThrow(TenantScopeError);
    await expect(
      scoped.$transaction(async (tx) => tx.$executeRawUnsafe("SELECT 1")),
    ).rejects.toThrow(TenantScopeError);
  });

  it("keeps the company filter inside transactions", async () => {
    const rows = await forOrganization(orgB).$transaction(async (tx) =>
      tx.membership.findMany(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgB)).toBe(true);
  });
});
