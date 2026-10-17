import { afterAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { isMfaRequired } from "@/platform/auth";
import {
  acceptOwnershipTransfer,
  assertOwnerAction,
  cancelOwnershipTransfer,
  getPendingOwnershipTransfer,
  isAllowed,
  loadSubject,
  offerOwnershipTransfer,
  type Role,
} from "@/platform/authorization";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// USR-03B: the transfer is atomic and leaves exactly one titular; the
// previous one keeps only the roles they chose. NEG-26 of the matrix.

const stamp = Date.now();
let counter = 0;

async function newUser(label: string, mfa = true) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `${label}.${++counter}.own.${stamp}@example.test`,
      emailVerified: true,
      twoFactorEnabled: mfa,
    },
  });
  return user.id;
}

async function addMember(
  organizationId: string,
  userId: string,
  roles: Role[] = [],
  status: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId, status },
  });
  for (const role of roles) {
    await db.membershipRole.create({
      data: { id: newId(), organizationId, membershipId: membership.id, role },
    });
  }
  return membership.id;
}

type Scenario = { org: string; owner: string; recipient: string };

/** A company with its titular and one member who could receive it. */
async function scenario(
  options: { recipientMfa?: boolean } = {},
): Promise<Scenario> {
  const owner = await newUser("titular");
  const created = await createOrganization(owner, {
    name: `Ferretería ${++counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  const recipient = await newUser("sucesor", options.recipientMfa ?? true);
  await addMember(created.organizationId, recipient, ["administrator"]);
  return { org: created.organizationId, owner, recipient };
}

async function offer(s: Scenario, roles?: string[]) {
  const result = await offerOwnershipTransfer(s.org, s.owner, {
    toUserId: s.recipient,
    ...(roles ? { previousOwnerRoles: roles } : {}),
  });
  if (!result.ok) throw new Error(`offer failed: ${result.reason}`);
  return result.transferId;
}

const ownerOf = async (org: string) =>
  (await db.organization.findUniqueOrThrow({ where: { id: org } })).ownerUserId;

afterAll(async () => {
  await db.$disconnect();
});

describe("offerOwnershipTransfer", () => {
  it("does not change the titular until it is accepted", async () => {
    const s = await scenario();
    await offer(s);
    expect(await ownerOf(s.org)).toBe(s.owner);
    expect(await getPendingOwnershipTransfer(s.org)).toMatchObject({
      fromUserId: s.owner,
      toUserId: s.recipient,
      previousOwnerRoles: ["viewer"],
    });
  });

  it("only the titular can offer", async () => {
    const s = await scenario();
    expect(
      await offerOwnershipTransfer(s.org, s.recipient, { toUserId: s.owner }),
    ).toMatchObject({ ok: false, reason: "not_owner" });
    const outsider = await newUser("ajeno");
    expect(
      await offerOwnershipTransfer(s.org, outsider, { toUserId: s.recipient }),
    ).toMatchObject({ ok: false, reason: "not_owner" });
    expect(await getPendingOwnershipTransfer(s.org)).toBeNull();
  });

  it("the recipient must be another active member of the same company", async () => {
    const s = await scenario();
    const outsider = await newUser("ajeno");
    const disabled = await newUser("baja");
    await addMember(s.org, disabled, ["viewer"], "DISABLED");
    for (const toUserId of [s.owner, outsider, disabled, newId()]) {
      expect(
        await offerOwnershipTransfer(s.org, s.owner, { toUserId }),
      ).toMatchObject({ ok: false, reason: "invalid_recipient" });
    }
  });

  it.each([[[]], [["owner"]], [["viewer", "titular"]]])(
    "rejects roles %j for the previous titular",
    async (roles) => {
      const s = await scenario();
      expect(
        await offerOwnershipTransfer(s.org, s.owner, {
          toUserId: s.recipient,
          previousOwnerRoles: roles,
        }),
      ).toMatchObject({ ok: false, reason: "invalid_roles" });
    },
  );

  it("a new offer replaces the previous one", async () => {
    const s = await scenario();
    const first = await offer(s);
    const other = await newUser("otro");
    await addMember(s.org, other, ["viewer"]);
    const second = await offerOwnershipTransfer(s.org, s.owner, {
      toUserId: other,
    });
    expect(second.ok).toBe(true);
    expect(
      await acceptOwnershipTransfer(s.org, s.recipient, first),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await db.ownershipTransfer.count({
        where: { organizationId: s.org, status: "PENDING" },
      }),
    ).toBe(1);
  });

  it("is recorded in the audit log", async () => {
    const s = await scenario();
    await offer(s);
    expect(
      await db.auditEvent.count({
        where: {
          organizationId: s.org,
          action: "ownership.transfer_offered",
          actorUserId: s.owner,
        },
      }),
    ).toBe(1);
  });
});

describe("acceptOwnershipTransfer", () => {
  it("moves the titular, and the previous one keeps only the chosen roles", async () => {
    const s = await scenario();
    const transferId = await offer(s, ["buyer", "viewer"]);
    expect(
      await acceptOwnershipTransfer(s.org, s.recipient, transferId),
    ).toEqual({ ok: true });

    expect(await ownerOf(s.org)).toBe(s.recipient);
    expect(await loadSubject(s.org, s.recipient)).toEqual({
      isOwner: true,
      roles: [],
    });
    const previous = await loadSubject(s.org, s.owner);
    expect(previous.isOwner).toBe(false);
    expect([...previous.roles].sort()).toEqual(["buyer", "viewer"]);

    // Reserved powers moved with the title, immediately.
    await expect(
      assertOwnerAction(s.org, s.recipient, "platform.subscription.cancel"),
    ).resolves.toBeUndefined();
    await expect(
      assertOwnerAction(s.org, s.owner, "platform.subscription.cancel"),
    ).rejects.toMatchObject({ code: "owner_only" });
    expect(await isAllowed(s.org, s.owner, "platform.team.invite")).toBe(false);
    expect(await isAllowed(s.org, s.owner, "purchasing.order.create")).toBe(
      true,
    );
    expect(await isMfaRequired(s.recipient)).toBe(true);

    expect(
      await db.auditEvent.count({
        where: {
          organizationId: s.org,
          action: "ownership.transferred",
          actorUserId: s.recipient,
        },
      }),
    ).toBe(1);
  });

  it("by default the previous titular becomes Consulta, never Administrador", async () => {
    const s = await scenario();
    await acceptOwnershipTransfer(s.org, s.recipient, await offer(s));
    expect((await loadSubject(s.org, s.owner)).roles).toEqual(["viewer"]);
  });

  it("needs MFA active on the recipient", async () => {
    const s = await scenario({ recipientMfa: false });
    const transferId = await offer(s);
    expect(
      await acceptOwnershipTransfer(s.org, s.recipient, transferId),
    ).toMatchObject({ ok: false, reason: "mfa_required" });
    expect(await ownerOf(s.org)).toBe(s.owner);

    await db.user.update({
      where: { id: s.recipient },
      data: { twoFactorEnabled: true },
    });
    expect(
      await acceptOwnershipTransfer(s.org, s.recipient, transferId),
    ).toEqual({ ok: true });
  });

  it("only the chosen person can accept, and only in that company", async () => {
    const s = await scenario();
    const other = await scenario();
    const transferId = await offer(s);
    const bystander = await newUser("testigo");
    await addMember(s.org, bystander, ["administrator"]);
    for (const [org, user] of [
      [s.org, bystander],
      [s.org, s.owner],
      [other.org, s.recipient],
      [other.org, other.owner],
      [newId(), s.recipient],
    ] as const) {
      expect(
        await acceptOwnershipTransfer(org, user, transferId),
      ).toMatchObject({ ok: false, reason: "not_found" });
    }
    expect(await ownerOf(s.org)).toBe(s.owner);
    expect(await ownerOf(other.org)).toBe(other.owner);
  });

  it("an offer cannot be used twice", async () => {
    const s = await scenario();
    const transferId = await offer(s);
    await acceptOwnershipTransfer(s.org, s.recipient, transferId);
    expect(
      await acceptOwnershipTransfer(s.org, s.recipient, transferId),
    ).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("an expired offer is rejected", async () => {
    const s = await scenario();
    const transferId = await offer(s);
    await db.ownershipTransfer.update({
      where: { id: transferId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      await acceptOwnershipTransfer(s.org, s.recipient, transferId),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(await getPendingOwnershipTransfer(s.org)).toBeNull();
    expect(await ownerOf(s.org)).toBe(s.owner);
  });

  it("a cancelled offer is rejected", async () => {
    const s = await scenario();
    const transferId = await offer(s);
    expect(await cancelOwnershipTransfer(s.org, s.recipient)).toMatchObject({
      ok: false,
      reason: "not_owner",
    });
    expect(await cancelOwnershipTransfer(s.org, s.owner)).toEqual({ ok: true });
    expect(
      await acceptOwnershipTransfer(s.org, s.recipient, transferId),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await cancelOwnershipTransfer(s.org, s.owner)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("a recipient disabled after the offer cannot accept", async () => {
    const s = await scenario();
    const transferId = await offer(s);
    await db.membership.updateMany({
      where: { organizationId: s.org, userId: s.recipient },
      data: { status: "DISABLED" },
    });
    expect(
      await acceptOwnershipTransfer(s.org, s.recipient, transferId),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await ownerOf(s.org)).toBe(s.owner);
  });

  it("the previous titular can no longer offer or cancel", async () => {
    const s = await scenario();
    await acceptOwnershipTransfer(s.org, s.recipient, await offer(s));
    expect(
      await offerOwnershipTransfer(s.org, s.owner, { toUserId: s.recipient }),
    ).toMatchObject({ ok: false, reason: "not_owner" });
    expect(await cancelOwnershipTransfer(s.org, s.owner)).toMatchObject({
      ok: false,
      reason: "not_owner",
    });
  });

  it("concurrent acceptances leave one titular and one transfer", async () => {
    const s = await scenario();
    const transferId = await offer(s);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        acceptOwnershipTransfer(s.org, s.recipient, transferId),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await ownerOf(s.org)).toBe(s.recipient);
    expect(
      await db.auditEvent.count({
        where: { organizationId: s.org, action: "ownership.transferred" },
      }),
    ).toBe(1);
    expect((await loadSubject(s.org, s.owner)).roles).toEqual(["viewer"]);
  });

  it("accepting while the titular re-offers never yields two titulares", async () => {
    const s = await scenario();
    const transferId = await offer(s);
    const other = await newUser("otro");
    await addMember(s.org, other, ["viewer"]);
    const [accepted, reoffered] = await Promise.all([
      acceptOwnershipTransfer(s.org, s.recipient, transferId),
      offerOwnershipTransfer(s.org, s.owner, { toUserId: other }),
    ]);
    // Either the acceptance won (the re-offer is refused: no longer titular)
    // or the re-offer won (the old offer is gone).
    expect(accepted.ok).not.toBe(reoffered.ok);
    expect(await ownerOf(s.org)).toBe(accepted.ok ? s.recipient : s.owner);
  });
});
