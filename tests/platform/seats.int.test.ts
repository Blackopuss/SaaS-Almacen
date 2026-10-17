import { afterAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  acceptInvitation,
  assignRoles,
  cancelInvitation,
  createInvitation,
  disableMember,
  getSeatUsage,
  reactivateMember,
  resendInvitation,
  type Role,
} from "@/platform/authorization";
import { memoryOutboxFor } from "@/platform/email";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

import { grantSeats } from "../setup/plan";

// MOD-08: seats per plan. With 4 of 5 seats, two simultaneous invitations
// allow exactly one; pending invitations count.

const stamp = Date.now();
let counter = 0;
const address = (label = "persona") =>
  `${label}.${++counter}.seat.${stamp}@example.test`;

async function newUser(email = address()) {
  return db.user.create({
    data: { id: newId(), name: "Persona", email, emailVerified: true },
  });
}

/** Company with a seat limit and `members` active people (titular included). */
async function company(seats: number | null, members = 1) {
  const owner = await newUser(address("titular"));
  const created = await createOrganization(owner.id, {
    name: `Empresa ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  const org = created.organizationId;
  if (seats !== null) await grantSeats(org, seats);
  for (let i = 1; i < members; i++) await addMember(org, ["viewer"]);
  return { org, owner: owner.id };
}

async function addMember(organizationId: string, roles: Role[]) {
  const user = await newUser();
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId: user.id },
  });
  for (const role of roles) {
    await db.membershipRole.create({
      data: { id: newId(), organizationId, membershipId: membership.id, role },
    });
  }
  return user.id;
}

const invite = (org: string, owner: string, email = address("invitado")) =>
  createInvitation(org, owner, { email, roles: ["viewer"] });

afterAll(async () => {
  await db.$disconnect();
});

describe("inviting takes a seat", () => {
  it("with 4 of 5 seats, two simultaneous invitations allow exactly one", async () => {
    const { org, owner } = await company(5, 4);
    const results = await Promise.all([invite(org, owner), invite(org, owner)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused).toMatchObject({
      ok: false,
      formError: expect.stringContaining("Tu plan incluye 5 usuarios"),
    });
    expect(await getSeatUsage(org)).toEqual({
      limit: 5,
      members: 4,
      pendingInvitations: 1,
      available: 0,
    });
  });

  it("with 2 seats left, 6 simultaneous invitations allow exactly 2", async () => {
    const { org, owner } = await company(5, 3);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => invite(org, owner)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect((await getSeatUsage(org)).pendingInvitations).toBe(2);
  });

  it("pending invitations count: no more room after the last one", async () => {
    const { org, owner } = await company(3, 1);
    expect((await invite(org, owner)).ok).toBe(true);
    expect((await invite(org, owner)).ok).toBe(true);
    const email = address("sin-lugar");
    expect(await invite(org, owner, email)).toMatchObject({ ok: false });
    // Nothing was sent or stored for the refused one.
    expect(memoryOutboxFor(email)).toHaveLength(0);
    expect(await db.invitation.count({ where: { email } })).toBe(0);
  });

  it("the titular alone fills a plan of one user", async () => {
    const { org, owner } = await company(1);
    expect(await invite(org, owner)).toMatchObject({
      ok: false,
      formError: expect.stringContaining("Tu plan incluye 1 usuario y"),
    });
  });

  it("without a plan with users nobody can be invited", async () => {
    const { org, owner } = await company(null);
    expect(await invite(org, owner)).toMatchObject({
      ok: false,
      formError: expect.stringContaining("todavía no tiene un plan"),
    });
    expect(await getSeatUsage(org)).toEqual({
      limit: null,
      members: 1,
      pendingInvitations: 0,
      available: 0,
    });
  });

  it("inviting the same address again does not take a second seat", async () => {
    const { org, owner } = await company(2);
    const email = address("repetida");
    expect((await invite(org, owner, email)).ok).toBe(true);
    expect((await invite(org, owner, email)).ok).toBe(true);
    expect((await getSeatUsage(org)).pendingInvitations).toBe(1);
  });

  it("a refused replacement keeps the previous invitation alive", async () => {
    const { org, owner } = await company(2);
    const email = address("conservada");
    const first = await invite(org, owner, email);
    if (!first.ok) throw new Error("expected ok");
    // The plan shrinks below what is in use.
    await grantSeats(org, 1);
    expect(await invite(org, owner, email)).toMatchObject({ ok: false });
    expect(
      (
        await db.invitation.findUniqueOrThrow({
          where: { id: first.invitationId },
        })
      ).status,
    ).toBe("PENDING");
  });

  it("combined roles take one seat", async () => {
    const { org, owner } = await company(3, 2);
    const member = (
      await db.membership.findFirstOrThrow({
        where: { organizationId: org, userId: { not: owner } },
      })
    ).userId;
    await assignRoles(org, owner, {
      userId: member,
      roles: ["warehouse", "buyer", "viewer"],
    });
    expect((await getSeatUsage(org)).members).toBe(2);
    expect((await invite(org, owner)).ok).toBe(true);
  });

  it("each company has its own seats", async () => {
    const full = await company(1);
    const roomy = await company(5);
    expect((await invite(full.org, full.owner)).ok).toBe(false);
    expect((await invite(roomy.org, roomy.owner)).ok).toBe(true);
  });
});

describe("seats come back", () => {
  it("cancelling an invitation frees its seat", async () => {
    const { org, owner } = await company(2);
    const first = await invite(org, owner);
    if (!first.ok) throw new Error("expected ok");
    expect((await invite(org, owner)).ok).toBe(false);
    await cancelInvitation(org, owner, first.invitationId);
    expect((await invite(org, owner)).ok).toBe(true);
  });

  it("an expired invitation stops holding its seat; renewing it needs one again", async () => {
    const { org, owner } = await company(2);
    const expired = await invite(org, owner);
    if (!expired.ok) throw new Error("expected ok");
    await db.invitation.update({
      where: { id: expired.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await getSeatUsage(org)).pendingInvitations).toBe(0);
    // Someone else takes the seat…
    expect((await invite(org, owner)).ok).toBe(true);
    // …so the expired one cannot be renewed.
    expect(
      await resendInvitation(org, owner, expired.invitationId),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Tu plan incluye 2 usuarios"),
    });
  });

  it("resending a live invitation needs no extra seat", async () => {
    const { org, owner } = await company(2);
    const invitation = await invite(org, owner);
    if (!invitation.ok) throw new Error("expected ok");
    expect(await resendInvitation(org, owner, invitation.invitationId)).toEqual(
      { ok: true },
    );
    expect((await getSeatUsage(org)).pendingInvitations).toBe(1);
  });

  it("accepting keeps the same seat: pending becomes member", async () => {
    const { org, owner } = await company(2);
    const user = await newUser();
    const invitation = await invite(org, owner, user.email);
    if (!invitation.ok) throw new Error("expected ok");
    const url = memoryOutboxFor(user.email).at(-1)!.actionUrl!;
    expect(
      await acceptInvitation(user.id, new URL(url).searchParams.get("token")!),
    ).toMatchObject({ ok: true });
    expect(await getSeatUsage(org)).toEqual({
      limit: 2,
      members: 2,
      pendingInvitations: 0,
      available: 0,
    });
    expect((await invite(org, owner)).ok).toBe(false);
  });

  it("disabling a member frees a seat; reactivating needs one", async () => {
    const { org, owner } = await company(2, 2);
    const member = (
      await db.membership.findFirstOrThrow({
        where: { organizationId: org, userId: { not: owner } },
      })
    ).userId;
    expect((await invite(org, owner)).ok).toBe(false);
    await disableMember(org, owner, { userId: member });
    expect((await getSeatUsage(org)).available).toBe(1);
    // The freed seat goes to a new invitation…
    expect((await invite(org, owner)).ok).toBe(true);
    // …and the disabled member cannot come back until there is room.
    expect(
      await reactivateMember(org, owner, { userId: member }),
    ).toMatchObject({
      ok: false,
      reason: "no_seats",
      error: expect.stringContaining("Tu plan incluye 2 usuarios"),
    });
    await grantSeats(org, 3);
    expect(await reactivateMember(org, owner, { userId: member })).toEqual({
      ok: true,
    });
  });

  it("reactivating and inviting at once never exceed the plan", async () => {
    const { org, owner } = await company(2, 2);
    const member = (
      await db.membership.findFirstOrThrow({
        where: { organizationId: org, userId: { not: owner } },
      })
    ).userId;
    await disableMember(org, owner, { userId: member });
    await Promise.all([
      reactivateMember(org, owner, { userId: member }),
      invite(org, owner),
      invite(org, owner),
    ]);
    const usage = await getSeatUsage(org);
    expect(usage.members + usage.pendingInvitations).toBe(2);
  });

  it("a smaller plan removes nobody; it only stops new people", async () => {
    const { org, owner } = await company(5, 4);
    await grantSeats(org, 2);
    expect(await getSeatUsage(org)).toEqual({
      limit: 2,
      members: 4,
      pendingInvitations: 0,
      available: 0,
    });
    expect((await invite(org, owner)).ok).toBe(false);
    expect(
      await db.membership.count({
        where: { organizationId: org, status: "ACTIVE" },
      }),
    ).toBe(4);
  });
});
