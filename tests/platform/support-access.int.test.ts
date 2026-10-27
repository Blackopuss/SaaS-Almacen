import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import {
  SUPPORT_ACCESS_HOURS,
  assertAllowed,
  enterSupport,
  getSupportAccess,
  grantSupportAccess,
  isAllowed,
  leaveSupport,
  listOpenSupportAccess,
  revokeSupportAccess,
} from "@/platform/authorization";
import {
  createOrganization,
  resolveActiveOrganization,
} from "@/platform/tenancy";
import { db } from "@/server";

// PIL-12: platform staff looks into a company only while its titular keeps
// the access open, only to read, and everything lands in the company's
// audit trail.

const stamp = Date.now();

async function newUser(label: string) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `${label}.support.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function newSession(userId: string) {
  const session = await db.session.create({
    data: {
      id: newId(),
      userId,
      token: randomBytes(24).toString("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return session.id;
}

async function newCompany(ownerId: string, name: string) {
  const result = await createOrganization(ownerId, { name, timeZone: "" });
  if (!result.ok) throw new Error("company setup failed");
  return result.organizationId;
}

async function addAdministrator(organizationId: string, userId: string) {
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  await db.membershipRole.create({
    data: {
      id: newId(),
      organizationId,
      membershipId: membership.id,
      role: "administrator",
    },
  });
}

async function actions(organizationId: string) {
  const rows = await db.auditEvent.findMany({
    where: { organizationId, action: { startsWith: "support." } },
    orderBy: { id: "asc" },
    select: { action: true, actorUserId: true },
  });
  return rows.map((row) => `${row.action}:${row.actorUserId}`);
}

let owner = "";
let admin = "";
let staff = "";
let stranger = "";
let company = "";

beforeAll(async () => {
  owner = await newUser("titular");
  admin = await newUser("admin");
  staff = await newUser("soporte");
  stranger = await newUser("extrano");
  company = await newCompany(owner, "Ferretería con soporte");
  await addAdministrator(company, admin);
  await db.platformStaff.create({ data: { userId: staff } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("support access", () => {
  it("only the titular opens it; an administrator cannot", async () => {
    await expect(
      grantSupportAccess({ organizationId: company, userId: admin }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      revokeSupportAccess({ organizationId: company, userId: admin }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getSupportAccess(company)).until).toBeNull();
  });

  it("staff cannot enter while it is closed", async () => {
    const session = await newSession(staff);
    expect(await enterSupport(staff, session, company)).toMatchObject({
      ok: false,
    });
    expect(await isAllowed(company, staff, "inventory.product.read")).toBe(
      false,
    );
    // Even with the company forced onto its session.
    await db.session.update({
      where: { id: session },
      data: { activeOrganizationId: company },
    });
    expect(await resolveActiveOrganization(staff, session)).toBeNull();
  });

  it("opens for a fixed time; asking again does not stretch it", async () => {
    const before = Date.now();
    const first = await grantSupportAccess({
      organizationId: company,
      userId: owner,
    });
    expect(first.repeated).toBe(false);
    const hours = (first.until.getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(SUPPORT_ACCESS_HOURS - 0.1);
    expect(hours).toBeLessThan(SUPPORT_ACCESS_HOURS + 0.1);

    const again = await grantSupportAccess({
      organizationId: company,
      userId: owner,
    });
    expect(again).toEqual({ until: first.until, repeated: true });
    expect((await getSupportAccess(company)).until).toEqual(first.until);
    expect(
      (await listOpenSupportAccess()).filter(
        (row) => row.organizationId === company,
      ),
    ).toHaveLength(1);
  });

  it("someone who is not staff gets nothing from an open access", async () => {
    const session = await newSession(stranger);
    expect(await enterSupport(stranger, session, company)).toMatchObject({
      ok: false,
    });
    await db.session.update({
      where: { id: session },
      data: { activeOrganizationId: company },
    });
    expect(await resolveActiveOrganization(stranger, session)).toBeNull();
    expect(await isAllowed(company, stranger, "inventory.product.read")).toBe(
      false,
    );
  });

  it("staff enters and reads like Consulta: no writing, no exports, no costs", async () => {
    const session = await newSession(staff);
    expect(await enterSupport(staff, session, company)).toEqual({ ok: true });

    const active = await resolveActiveOrganization(staff, session);
    expect(active).toMatchObject({ id: company, isOwner: false });
    expect(active?.supportUntil).toBeInstanceOf(Date);

    expect(await isAllowed(company, staff, "inventory.product.read")).toBe(
      true,
    );
    for (const permission of [
      "inventory.adjustment.create",
      "inventory.export.create",
      "purchasing.cost.read",
      "platform.team.read",
      "platform.audit.read",
      "platform.support.grant",
    ] as const) {
      expect(await isAllowed(company, staff, permission), permission).toBe(
        false,
      );
    }
    await expect(
      assertAllowed(company, staff, "inventory.adjustment.create"),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await leaveSupport(staff, session);
    const saved = await db.session.findUniqueOrThrow({
      where: { id: session },
      select: { activeOrganizationId: true },
    });
    expect(saved.activeOrganizationId).toBeNull();
  });

  it("closing it ends support at once, and the titular sees everything", async () => {
    const session = await newSession(staff);
    expect(await enterSupport(staff, session, company)).toEqual({ ok: true });

    expect(
      await revokeSupportAccess({ organizationId: company, userId: owner }),
    ).toEqual({ closed: true });
    expect(await resolveActiveOrganization(staff, session)).toBeNull();
    expect(await isAllowed(company, staff, "inventory.product.read")).toBe(
      false,
    );
    expect(await enterSupport(staff, session, company)).toMatchObject({
      ok: false,
    });
    expect(
      await revokeSupportAccess({ organizationId: company, userId: owner }),
    ).toEqual({ closed: false });

    expect(await actions(company)).toEqual([
      `support.granted:${owner}`,
      `support.entered:${staff}`,
      `support.left:${staff}`,
      `support.entered:${staff}`,
      `support.revoked:${owner}`,
    ]);
  });

  it("an access past its time is closed", async () => {
    const other = await newCompany(
      await newUser("vencida"),
      "Ferretería vencida",
    );
    await db.supportAccess.create({
      data: {
        id: newId(),
        organizationId: other,
        grantedByUserId: owner,
        createdAt: new Date(Date.now() - 2 * 3_600_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      },
    });
    const session = await newSession(staff);
    expect(await enterSupport(staff, session, other)).toMatchObject({
      ok: false,
    });
    expect(await isAllowed(other, staff, "inventory.product.read")).toBe(false);
  });

  it("the database keeps the record: no deleting, no stretching, closing once", async () => {
    const other = await newCompany(
      await newUser("registro"),
      "Ferretería registro",
    );
    const id = newId();
    const now = Date.now();
    await db.supportAccess.create({
      data: {
        id,
        organizationId: other,
        grantedByUserId: owner,
        expiresAt: new Date(now + 3_600_000),
      },
    });
    await expect(db.supportAccess.delete({ where: { id } })).rejects.toThrow();
    await expect(
      db.supportAccess.update({
        where: { id },
        data: { expiresAt: new Date(now + 2 * 3_600_000) },
      }),
    ).rejects.toThrow();
    await db.supportAccess.update({
      where: { id },
      data: { revokedAt: new Date(), revokedByUserId: owner },
    });
    await expect(
      db.supportAccess.update({
        where: { id },
        data: { revokedAt: new Date(), revokedByUserId: owner },
      }),
    ).rejects.toThrow();
    // Never longer than seven days.
    await expect(
      db.supportAccess.create({
        data: {
          id: newId(),
          organizationId: other,
          grantedByUserId: owner,
          expiresAt: new Date(now + 8 * 24 * 3_600_000),
        },
      }),
    ).rejects.toThrow();
  });
});
