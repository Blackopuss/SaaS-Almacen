import { createTestOrganization } from "../setup/organization";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  LOCKING_TRANSACTION,
  TenantScopeError,
  db,
  forOrganization,
  lockRows,
} from "@/server";

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

  it("locks rows only of the active company, and only inside a transaction", async () => {
    const facilityA = await db.facility.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    const facilityB = await db.facility.findFirstOrThrow({
      where: { organizationId: orgB },
    });
    const scoped = forOrganization(orgA);
    expect(
      await scoped.$transaction((tx) =>
        lockRows(tx, "facility", [facilityB.id, facilityA.id, facilityA.id]),
      ),
    ).toEqual([facilityA.id]);
    expect(
      await scoped.$transaction((tx) => lockRows(tx, "facility", [])),
    ).toEqual([]);
    // Outside a transaction a lock would mean nothing.
    await expect(lockRows(scoped, "facility", [facilityA.id])).rejects.toThrow(
      TenantScopeError,
    );
    await expect(lockRows(db, "facility", [facilityA.id])).rejects.toThrow(
      TenantScopeError,
    );
    // Only the listed tables, and ids are never part of the SQL text.
    await expect(
      scoped.$transaction((tx) =>
        lockRows(tx, "user" as "facility", [facilityA.id]),
      ),
    ).rejects.toThrow(TenantScopeError);
    expect(
      await scoped.$transaction((tx) =>
        lockRows(tx, "facility", ["' OR 1=1 --"]),
      ),
    ).toEqual([]);
  });

  it("a locked row makes the second transaction wait for the first", async () => {
    const facility = await db.facility.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    const order: string[] = [];
    const first = forOrganization(orgA).$transaction(async (tx) => {
      await lockRows(tx, "facility", [facility.id]);
      order.push("first locked");
      await new Promise((resolve) => setTimeout(resolve, 300));
      order.push("first done");
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = forOrganization(orgA).$transaction(async (tx) => {
      await lockRows(tx, "facility", [facility.id]);
      order.push("second locked");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["first locked", "first done", "second locked"]);
  });

  it("a locking transaction reads what the previous holder of the lock committed", async () => {
    const facility = await db.facility.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    const scoped = forOrganization(orgA);
    const original = facility.name;
    // The second transaction reads once before waiting for the lock, as a
    // service that looks something up first would.
    const seen = async (options?: typeof LOCKING_TRANSACTION) => {
      const first = scoped.$transaction(async (tx) => {
        await lockRows(tx, "facility", [facility.id]);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await tx.facility.updateMany({
          where: { id: facility.id },
          data: { name: "Cambiada" },
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const second = scoped.$transaction(async (tx) => {
        await tx.facility.findFirst({ where: { id: facility.id } });
        await lockRows(tx, "facility", [facility.id]);
        return (await tx.facility.findFirst({ where: { id: facility.id } }))
          ?.name;
      }, options);
      const [, name] = await Promise.all([first, second]);
      await db.facility.update({
        where: { id: facility.id },
        data: { name: original },
      });
      return name;
    };
    // MySQL's default keeps the first snapshot: the decision would be stale.
    expect(await seen()).toBe(original);
    expect(await seen(LOCKING_TRANSACTION)).toBe("Cambiada");
  });

  it("keeps the company filter inside transactions", async () => {
    const rows = await forOrganization(orgB).$transaction(async (tx) =>
      tx.membership.findMany(),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgB)).toBe(true);
  });
});
