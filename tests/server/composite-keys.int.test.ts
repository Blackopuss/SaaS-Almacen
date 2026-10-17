import { createTestOrganization } from "../setup/organization";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { db, forOrganization } from "@/server";

// PLT-13: the database itself rejects linking rows of different companies
// (composite foreign keys with organizationId), even when the application
// layer is bypassed, and uniqueness is per company.

const stamp = Date.now();
const orgA = newId();
const orgB = newId();
let memberA = "";
let memberB = "";

beforeAll(async () => {
  const [ana, beto] = [newId(), newId()];
  await db.user.createMany({
    data: [
      { id: ana, name: "Ana", email: `ana.fk.${stamp}@example.test` },
      { id: beto, name: "Beto", email: `beto.fk.${stamp}@example.test` },
    ],
  });
  for (const [id, owner, name] of [
    [orgA, ana, "Empresa A"],
    [orgB, beto, "Empresa B"],
  ] as const) {
    await createTestOrganization({
      data: {
        id,
        name,
        ownerUserId: owner,
        memberships: { create: { id: newId(), userId: owner } },
      },
    });
  }
  memberA = (
    await db.membership.findFirstOrThrow({ where: { organizationId: orgA } })
  ).id;
  memberB = (
    await db.membership.findFirstOrThrow({ where: { organizationId: orgB } })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("composite foreign keys", () => {
  it("accept a role for a membership of the same company", async () => {
    const role = await forOrganization(orgA).membershipRole.create({
      data: {
        id: newId(),
        organizationId: orgA,
        membershipId: memberA,
        role: "viewer",
      },
    });
    expect(role.organizationId).toBe(orgA);
  });

  it("reject a role of company A that points to a membership of company B", async () => {
    await expect(
      forOrganization(orgA).membershipRole.create({
        data: {
          id: newId(),
          organizationId: orgA,
          membershipId: memberB,
          role: "viewer",
        },
      }),
    ).rejects.toThrow();
    // Same with the unscoped client: the database is the last line.
    await expect(
      db.membershipRole.create({
        data: {
          id: newId(),
          organizationId: orgB,
          membershipId: memberA,
          role: "viewer",
        },
      }),
    ).rejects.toThrow();
  });

  it("reject the mix even with raw SQL that skips the application", async () => {
    await expect(
      db.$executeRawUnsafe(
        "INSERT INTO membership_role (id, organizationId, membershipId, role) VALUES (?, ?, ?, 'viewer')",
        newId(),
        orgA,
        memberB,
      ),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("reject moving a role to another company's membership", async () => {
    const role = await db.membershipRole.findFirstOrThrow({
      where: { membershipId: memberA },
    });
    await expect(
      db.$executeRawUnsafe(
        "UPDATE membership_role SET membershipId = ? WHERE id = ?",
        memberB,
        role.id,
      ),
    ).rejects.toThrow(/foreign key constraint/i);
    await expect(
      db.$executeRawUnsafe(
        "UPDATE membership_role SET organizationId = ? WHERE id = ?",
        orgB,
        role.id,
      ),
    ).rejects.toThrow(/foreign key constraint/i);
  });
});

describe("uniqueness", () => {
  it("allows a role only once per membership", async () => {
    await expect(
      forOrganization(orgA).membershipRole.create({
        data: {
          id: newId(),
          organizationId: orgA,
          membershipId: memberA,
          role: "viewer",
        },
      }),
    ).rejects.toThrow();
  });

  it("is per company: the same person can be a member of two companies once each", async () => {
    const userId = (
      await db.membership.findUniqueOrThrow({ where: { id: memberA } })
    ).userId;
    await expect(
      db.membership.create({
        data: { id: newId(), organizationId: orgA, userId },
      }),
    ).rejects.toThrow();
    const second = await db.membership.create({
      data: { id: newId(), organizationId: orgB, userId },
    });
    expect(second.organizationId).toBe(orgB);
  });
});
