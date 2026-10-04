import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  assignRoles,
  countSeatsInUse,
  isAllowed,
  listTeamMembers,
  loadSubject,
  type Role,
} from "@/platform/authorization";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// USR-06: roles are assigned and combined; permissions join and the person
// still takes one seat.

const stamp = Date.now();
let counter = 0;

async function newUser(label: string) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `${label}.${++counter}.team.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function addMember(
  organizationId: string,
  roles: Role[],
  status: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  const userId = await newUser(roles[0] ?? "sin-rol");
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId, status },
  });
  for (const role of roles) {
    await db.membershipRole.create({
      data: { id: newId(), organizationId, membershipId: membership.id, role },
    });
  }
  return userId;
}

async function newCompany(name: string) {
  const owner = await newUser("titular");
  const created = await createOrganization(owner, { name, timeZone: "" });
  if (!created.ok) throw new Error("company setup failed");
  return { org: created.organizationId, owner };
}

const rolesOf = async (org: string, userId: string) =>
  [...(await loadSubject(org, userId)).roles].sort();

let org = "";
let owner = "";
let admin = "";
let other = { org: "", owner: "" };

beforeAll(async () => {
  ({ org, owner } = await newCompany("Ferretería La Esperanza"));
  other = await newCompany("Ferretería Ajena");
  admin = await addMember(org, ["administrator"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("assignRoles", () => {
  it("combined roles join their permissions and take one seat", async () => {
    const userId = await addMember(org, ["viewer"]);
    const seats = await countSeatsInUse(org);
    expect(
      await assignRoles(org, owner, { userId, roles: ["warehouse", "buyer"] }),
    ).toEqual({ ok: true });

    expect(await rolesOf(org, userId)).toEqual(["buyer", "warehouse"]);
    const expected = new Set<string>([
      ...ROLE_PERMISSIONS.warehouse,
      ...ROLE_PERMISSIONS.buyer,
    ]);
    for (const permission of PERMISSIONS) {
      expect(await isAllowed(org, userId, permission), permission).toBe(
        expected.has(permission),
      );
    }
    expect(await countSeatsInUse(org)).toBe(seats);
    expect(
      await db.membership.count({ where: { organizationId: org, userId } }),
    ).toBe(1);
  });

  it("replaces the previous roles and records the change", async () => {
    const userId = await addMember(org, ["warehouse", "buyer"]);
    await assignRoles(org, admin, { userId, roles: ["viewer"] });
    expect(await rolesOf(org, userId)).toEqual(["viewer"]);
    expect(await isAllowed(org, userId, "inventory.entry.create")).toBe(false);
    const event = await db.auditEvent.findFirstOrThrow({
      where: {
        organizationId: org,
        action: "team.roles_changed",
        targetId: userId,
      },
    });
    expect(event.actorUserId).toBe(admin);
    expect(event.metadata).toEqual({
      from: ["buyer", "warehouse"],
      to: ["viewer"],
    });
  });

  it("saving the same roles changes nothing", async () => {
    const userId = await addMember(org, ["buyer", "viewer"]);
    expect(
      await assignRoles(org, owner, { userId, roles: ["viewer", "buyer"] }),
    ).toMatchObject({ ok: false, reason: "unchanged" });
    expect(
      await db.auditEvent.count({
        where: { organizationId: org, targetId: userId },
      }),
    ).toBe(0);
  });

  it("only the titular names or changes administrators", async () => {
    const userId = await addMember(org, ["viewer"]);
    expect(
      await assignRoles(org, admin, { userId, roles: ["administrator"] }),
    ).toMatchObject({ ok: false, reason: "administrator_reserved" });
    expect(await rolesOf(org, userId)).toEqual(["viewer"]);

    expect(
      await assignRoles(org, owner, { userId, roles: ["administrator"] }),
    ).toEqual({ ok: true });
    expect(
      await assignRoles(org, admin, { userId, roles: ["viewer"] }),
    ).toMatchObject({ ok: false, reason: "administrator_reserved" });
    expect(await rolesOf(org, userId)).toEqual(["administrator"]);
  });

  it("an administrator cannot change their own roles", async () => {
    expect(
      await assignRoles(org, admin, {
        userId: admin,
        roles: ["administrator", "buyer"],
      }),
    ).toMatchObject({ ok: false, reason: "self" });
  });

  it("nobody changes the titular's roles", async () => {
    for (const actor of [admin, owner]) {
      expect(
        await assignRoles(org, actor, { userId: owner, roles: ["viewer"] }),
      ).toMatchObject({ ok: false, reason: "owner_protected" });
    }
    expect(await loadSubject(org, owner)).toEqual({ isOwner: true, roles: [] });
  });

  it.each([[[]], [["owner"]], [["viewer", "cajero"]], [["viewer", "viewer"]]])(
    "rejects roles %j",
    async (roles) => {
      const userId = await addMember(org, ["viewer"]);
      expect(await assignRoles(org, owner, { userId, roles })).toMatchObject({
        ok: false,
        reason: "invalid_roles",
      });
      expect(await rolesOf(org, userId)).toEqual(["viewer"]);
    },
  );

  it("people without the permission are refused, whoever the target is", async () => {
    const target = await addMember(org, ["viewer"]);
    for (const role of ["warehouse", "buyer", "viewer"] as const) {
      const actor = await addMember(org, [role]);
      for (const userId of [target, newId(), owner]) {
        expect(
          await assignRoles(org, actor, { userId, roles: ["buyer"] }),
        ).toMatchObject({ ok: false, reason: "forbidden" });
      }
    }
    const disabledAdmin = await addMember(org, ["administrator"], "DISABLED");
    expect(
      await assignRoles(org, disabledAdmin, {
        userId: target,
        roles: ["buyer"],
      }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await rolesOf(org, target)).toEqual(["viewer"]);
  });

  it("cannot reach people of another company", async () => {
    const theirs = await addMember(other.org, ["viewer"]);
    expect(
      await assignRoles(org, owner, { userId: theirs, roles: ["buyer"] }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await assignRoles(other.org, owner, { userId: theirs, roles: ["buyer"] }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await rolesOf(other.org, theirs)).toEqual(["viewer"]);
  });

  it("simultaneous changes leave one consistent set of roles", async () => {
    const userId = await addMember(org, ["viewer"]);
    const results = await Promise.all([
      assignRoles(org, owner, { userId, roles: ["warehouse"] }),
      assignRoles(org, owner, { userId, roles: ["buyer"] }),
      assignRoles(org, owner, { userId, roles: ["warehouse", "buyer"] }),
    ]);
    expect(results.some((r) => r.ok)).toBe(true);
    const roles = await rolesOf(org, userId);
    expect([["warehouse"], ["buyer"], ["buyer", "warehouse"]]).toContainEqual(
      roles,
    );
  });
});

describe("listTeamMembers", () => {
  it("lists the company's people, titular first, with roles and status", async () => {
    const company = await newCompany("Ferretería Chica");
    const disabled = await addMember(company.org, ["buyer"], "DISABLED");
    const both = await addMember(company.org, ["warehouse", "buyer"]);
    const members = await listTeamMembers(company.org);
    expect(members).toHaveLength(3);
    expect(members[0]).toMatchObject({
      userId: company.owner,
      isOwner: true,
      roles: [],
      status: "ACTIVE",
    });
    expect(members.find((m) => m.userId === disabled)?.status).toBe("DISABLED");
    expect(members.find((m) => m.userId === both)?.roles).toEqual([
      "buyer",
      "warehouse",
    ]);
    // Disabled members free their seat.
    expect(await countSeatsInUse(company.org)).toBe(2);
  });
});
