import { createTestOrganization } from "../setup/organization";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { isMfaRequired } from "@/platform/auth";
import { ROLES } from "@/platform/authorization";
import { db, forOrganization } from "@/server";

// USR-01: only roles of the approved catalog can be stored, even with SQL
// that skips the application. The titular is not a role.

const stamp = Date.now();
const orgId = newId();
let membershipId = "";

beforeAll(async () => {
  const userId = newId();
  await db.user.create({
    data: { id: userId, name: "Roles", email: `roles.${stamp}@example.test` },
  });
  await createTestOrganization({
    data: {
      id: orgId,
      name: "Empresa de roles",
      ownerUserId: userId,
      memberships: { create: { id: newId(), userId } },
    },
  });
  membershipId = (
    await db.membership.findFirstOrThrow({ where: { organizationId: orgId } })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("membership roles in the database", () => {
  it("accepts every role of the catalog", async () => {
    for (const role of ROLES) {
      await forOrganization(orgId).membershipRole.create({
        data: { id: newId(), organizationId: orgId, membershipId, role },
      });
    }
    expect(await db.membershipRole.count({ where: { membershipId } })).toBe(
      ROLES.length,
    );
  });

  it.each(["owner", "titular", "cajero", "Administrador", ""])(
    "rejects %j",
    async (role) => {
      await expect(
        db.$executeRawUnsafe(
          "INSERT INTO membership_role (id, organizationId, membershipId, role) VALUES (?, ?, ?, ?)",
          newId(),
          orgId,
          membershipId,
          role,
        ),
      ).rejects.toThrow(/membership_role_role_check/);
    },
  );
});

describe("mandatory MFA by role", () => {
  async function memberWith(
    role: string | null,
    status: "ACTIVE" | "DISABLED",
  ) {
    const userId = newId();
    await db.user.create({
      data: {
        id: userId,
        name: "Miembro",
        email: `mfa.${userId}@example.test`,
      },
    });
    const membership = await db.membership.create({
      data: { id: newId(), organizationId: orgId, userId, status },
    });
    if (role) {
      await db.membershipRole.create({
        data: {
          id: newId(),
          organizationId: orgId,
          membershipId: membership.id,
          role,
        },
      });
    }
    return userId;
  }

  it("is required for an active administrator", async () => {
    expect(
      await isMfaRequired(await memberWith("administrator", "ACTIVE")),
    ).toBe(true);
  });

  it("is optional for other roles and for a disabled administrator", async () => {
    for (const role of ["warehouse", "buyer", "viewer"]) {
      expect(await isMfaRequired(await memberWith(role, "ACTIVE"))).toBe(false);
    }
    expect(
      await isMfaRequired(await memberWith("administrator", "DISABLED")),
    ).toBe(false);
  });
});
