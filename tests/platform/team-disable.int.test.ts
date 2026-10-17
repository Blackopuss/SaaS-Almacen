import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { listAuditEvents } from "@/platform/audit";
import {
  acceptOwnershipTransfer,
  assignRoles,
  countSeatsInUse,
  disableMember,
  isAllowed,
  listTeamMembers,
  offerOwnershipTransfer,
  reactivateMember,
  type Role,
} from "@/platform/authorization";
import {
  createOrganization,
  resolveActiveOrganization,
} from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

import { grantSeats } from "../setup/plan";

// USR-07: disabling a member revokes their sessions and keeps their
// authorship in the history.

const stamp = Date.now();
let counter = 0;

async function newUser(label: string) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `${label}.${++counter}.dis.${stamp}@example.test`,
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  return user.id;
}

async function addMember(organizationId: string, roles: Role[]) {
  const userId = await newUser(roles[0] ?? "sin-rol");
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  for (const role of roles) {
    await db.membershipRole.create({
      data: { id: newId(), organizationId, membershipId: membership.id, role },
    });
  }
  return userId;
}

async function newSession(userId: string, activeOrganizationId?: string) {
  const session = await db.session.create({
    data: {
      id: newId(),
      userId,
      token: randomBytes(24).toString("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
      ...(activeOrganizationId ? { activeOrganizationId } : {}),
    },
  });
  return session.id;
}

async function newCompany(name: string) {
  const owner = await newUser("titular");
  const created = await createOrganization(owner, { name, timeZone: "" });
  if (!created.ok) throw new Error("company setup failed");
  await grantSeats(created.organizationId);
  return { org: created.organizationId, owner };
}

const statusOf = async (org: string, userId: string) =>
  (
    await db.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: org, userId } },
    })
  ).status;

let org = "";
let owner = "";
let admin = "";

beforeAll(async () => {
  ({ org, owner } = await newCompany("Ferretería La Esperanza"));
  admin = await addMember(org, ["administrator"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("disableMember", () => {
  it("cuts access at once and closes every session of the person", async () => {
    const userId = await addMember(org, ["warehouse"]);
    const sessions = [await newSession(userId, org), await newSession(userId)];
    const seats = await countSeatsInUse(org);
    expect(await isAllowed(org, userId, "inventory.entry.create")).toBe(true);

    expect(
      await disableMember(org, admin, { userId, reason: "Ya no trabaja aquí" }),
    ).toEqual({ ok: true });

    expect(await statusOf(org, userId)).toBe("DISABLED");
    expect(await db.session.count({ where: { id: { in: sessions } } })).toBe(0);
    expect(await isAllowed(org, userId, "inventory.entry.create")).toBe(false);
    expect(await isAllowed(org, userId, "inventory.product.read")).toBe(false);
    expect(await countSeatsInUse(org)).toBe(seats - 1);

    // Signing in again does not bring the company back.
    const later = await newSession(userId);
    expect(await resolveActiveOrganization(userId, later)).toBeNull();
  });

  it("does not touch other people's sessions", async () => {
    const userId = await addMember(org, ["viewer"]);
    const bystander = await addMember(org, ["viewer"]);
    const kept = await newSession(bystander, org);
    await disableMember(org, owner, { userId });
    expect(await db.session.count({ where: { id: kept } })).toBe(1);
  });

  it("keeps the person's authorship in the history", async () => {
    const userId = await addMember(org, ["administrator"]);
    const target = await addMember(org, ["viewer"]);
    await assignRoles(org, userId, { userId: target, roles: ["buyer"] });
    await disableMember(org, owner, { userId });

    const events = await listAuditEvents(forOrganization(org), { limit: 200 });
    expect(
      events.some(
        (e) => e.action === "team.roles_changed" && e.actorUserId === userId,
      ),
    ).toBe(true);
    // Their name is still there to show next to what they did.
    const member = (await listTeamMembers(org)).find(
      (m) => m.userId === userId,
    );
    expect(member).toMatchObject({
      status: "DISABLED",
      name: "administrator",
      roles: ["administrator"],
    });
    expect(await db.user.count({ where: { id: userId } })).toBe(1);
  });

  it("is recorded with reason, roles and sessions closed", async () => {
    const userId = await addMember(org, ["buyer", "viewer"]);
    await newSession(userId, org);
    await disableMember(org, admin, { userId, reason: "  Renunció  " });
    const event = await db.auditEvent.findFirstOrThrow({
      where: {
        organizationId: org,
        action: "team.member_disabled",
        targetId: userId,
      },
    });
    expect(event).toMatchObject({
      actorUserId: admin,
      reason: "Renunció",
      metadata: { roles: ["buyer", "viewer"], sessionsClosed: 1 },
    });
  });

  it("nobody disables the titular", async () => {
    await newSession(owner, org);
    for (const actor of [admin, owner]) {
      expect(await disableMember(org, actor, { userId: owner })).toMatchObject({
        ok: false,
        reason: "owner_protected",
      });
    }
    expect(await statusOf(org, owner)).toBe("ACTIVE");
    expect(await db.session.count({ where: { userId: owner } })).toBe(1);
  });

  it("an administrator cannot disable themselves or another administrator", async () => {
    const otherAdmin = await addMember(org, ["administrator"]);
    expect(await disableMember(org, admin, { userId: admin })).toMatchObject({
      ok: false,
      reason: "self",
    });
    expect(
      await disableMember(org, admin, { userId: otherAdmin }),
    ).toMatchObject({ ok: false, reason: "administrator_reserved" });
    expect(await disableMember(org, owner, { userId: otherAdmin })).toEqual({
      ok: true,
    });
  });

  it.each(["warehouse", "buyer", "viewer"] as const)(
    "%s cannot disable anyone",
    async (role) => {
      const actor = await addMember(org, [role]);
      const target = await addMember(org, ["viewer"]);
      expect(await disableMember(org, actor, { userId: target })).toMatchObject(
        { ok: false, reason: "forbidden" },
      );
      expect(await statusOf(org, target)).toBe("ACTIVE");
    },
  );

  it("cannot reach people of another company", async () => {
    const other = await newCompany("Ferretería Ajena");
    const theirs = await addMember(other.org, ["viewer"]);
    const session = await newSession(theirs, other.org);
    expect(await disableMember(org, owner, { userId: theirs })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(
      await disableMember(other.org, owner, { userId: theirs }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await statusOf(other.org, theirs)).toBe("ACTIVE");
    expect(await db.session.count({ where: { id: session } })).toBe(1);
  });

  it("disabling twice changes nothing the second time", async () => {
    const userId = await addMember(org, ["viewer"]);
    await disableMember(org, owner, { userId });
    expect(await disableMember(org, owner, { userId })).toMatchObject({
      ok: false,
      reason: "unchanged",
    });
    expect(
      await db.auditEvent.count({
        where: { action: "team.member_disabled", targetId: userId },
      }),
    ).toBe(1);
  });

  it("a disabled administrator can no longer manage the team", async () => {
    const formerAdmin = await addMember(org, ["administrator"]);
    const target = await addMember(org, ["viewer"]);
    await disableMember(org, owner, { userId: formerAdmin });
    expect(
      await disableMember(org, formerAdmin, { userId: target }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect(
      await assignRoles(org, formerAdmin, { userId: target, roles: ["buyer"] }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("cancels a pending offer to hand them the company", async () => {
    const company = await newCompany("Ferretería En Venta");
    const heir = await addMember(company.org, ["viewer"]);
    const offer = await offerOwnershipTransfer(company.org, company.owner, {
      toUserId: heir,
    });
    if (!offer.ok) throw new Error("offer failed");
    await disableMember(company.org, company.owner, { userId: heir });
    await reactivateMember(company.org, company.owner, { userId: heir });
    expect(
      await acceptOwnershipTransfer(company.org, heir, offer.transferId),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("reactivateMember", () => {
  it("gives access back with the same roles and records it", async () => {
    const userId = await addMember(org, ["warehouse", "buyer"]);
    await disableMember(org, owner, { userId });
    expect(await reactivateMember(org, admin, { userId })).toEqual({
      ok: true,
    });
    expect(await statusOf(org, userId)).toBe("ACTIVE");
    expect(await isAllowed(org, userId, "purchasing.order.create")).toBe(true);
    expect(
      await db.auditEvent.count({
        where: { action: "team.member_reactivated", targetId: userId },
      }),
    ).toBe(1);
    expect(await reactivateMember(org, admin, { userId })).toMatchObject({
      ok: false,
      reason: "unchanged",
    });
  });

  it("only the titular reactivates an administrator", async () => {
    const userId = await addMember(org, ["administrator"]);
    await disableMember(org, owner, { userId });
    expect(await reactivateMember(org, admin, { userId })).toMatchObject({
      ok: false,
      reason: "administrator_reserved",
    });
    expect(await reactivateMember(org, owner, { userId })).toEqual({
      ok: true,
    });
  });

  it("a disabled person cannot reactivate themselves", async () => {
    const userId = await addMember(org, ["administrator"]);
    await disableMember(org, owner, { userId });
    expect(await reactivateMember(org, userId, { userId })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  });
});
