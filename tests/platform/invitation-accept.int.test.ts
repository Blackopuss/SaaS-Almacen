import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { auth } from "@/platform/auth";
import {
  acceptInvitation,
  acceptInvitationAsNewUser,
  cancelInvitation,
  createInvitation,
  hashInvitationToken,
  isAllowed,
  loadSubject,
  previewInvitation,
} from "@/platform/authorization";
import { memoryOutboxFor } from "@/platform/email";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

import { grantSeats } from "../setup/plan";

// USR-05: accepting creates the membership with the invited roles, for a
// new or an existing account; a reused or expired token is rejected.

const stamp = Date.now();
let counter = 0;
const address = (label: string) =>
  `${label}.${++counter}.acc.${stamp}@example.test`;
const PASSWORD = "una frase larga y segura 2026";
const SLOW = 30_000;

/** Each call comes from its own test IP so the per-IP limit never mixes tests. */
const from = (ip = `198.51.100.${(++counter % 250) + 1}`) =>
  new Headers({ "x-forwarded-for": ip });

async function newUser(email = address("persona"), verified = true) {
  return db.user.create({
    data: { id: newId(), name: "Persona", email, emailVerified: verified },
  });
}

let org = "";
let owner = "";

async function invite(email: string, roles: string[] = ["warehouse"]) {
  const result = await createInvitation(org, owner, { email, roles });
  if (!result.ok) throw new Error("invitation failed");
  const messages = memoryOutboxFor(email);
  const url = messages[messages.length - 1]!.actionUrl!;
  return {
    id: result.invitationId,
    token: new URL(url).searchParams.get("token")!,
  };
}

beforeAll(async () => {
  owner = (await newUser(address("titular"))).id;
  const created = await createOrganization(owner, {
    name: "Ferretería La Esperanza",
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  await grantSeats(created.organizationId);
  org = created.organizationId;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("previewInvitation", () => {
  it("shows company, email and roles of a valid link", async () => {
    const email = address("vista");
    const { token } = await invite(email, ["buyer", "viewer"]);
    expect(await previewInvitation(token)).toEqual({
      organizationName: "Ferretería La Esperanza",
      email,
      roles: ["buyer", "viewer"],
      hasAccount: false,
    });
    await newUser(email);
    expect((await previewInvitation(token))?.hasAccount).toBe(true);
  });

  it.each(["", "x", "no-existe-pero-tiene-forma-de-token-123456", "a b c"])(
    "answers nothing for %j",
    async (token) => {
      expect(await previewInvitation(token)).toBeNull();
    },
  );
});

describe("acceptInvitation (existing account)", () => {
  it("creates the membership with the invited roles", async () => {
    const user = await newUser();
    const { id, token } = await invite(user.email, ["warehouse", "buyer"]);
    expect(await acceptInvitation(user.id, token)).toEqual({
      ok: true,
      organizationId: org,
    });
    const subject = await loadSubject(org, user.id);
    expect(subject.isOwner).toBe(false);
    expect([...subject.roles].sort()).toEqual(["buyer", "warehouse"]);
    expect(await isAllowed(org, user.id, "purchasing.order.create")).toBe(true);
    expect(await isAllowed(org, user.id, "platform.team.invite")).toBe(false);
    expect(
      (await db.invitation.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("ACCEPTED");
    expect(
      await db.auditEvent.count({
        where: {
          organizationId: org,
          action: "team.invitation_accepted",
          actorUserId: user.id,
          targetId: id,
        },
      }),
    ).toBe(1);
  });

  it("a used token is rejected", async () => {
    const user = await newUser();
    const { token } = await invite(user.email);
    await acceptInvitation(user.id, token);
    expect(await acceptInvitation(user.id, token)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await previewInvitation(token)).toBeNull();
  });

  it("an expired token is rejected", async () => {
    const user = await newUser();
    const { id, token } = await invite(user.email);
    await db.invitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await previewInvitation(token)).toBeNull();
    expect(await acceptInvitation(user.id, token)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(
      await db.membership.count({
        where: { organizationId: org, userId: user.id },
      }),
    ).toBe(0);
  });

  it("a cancelled or replaced token is rejected", async () => {
    const user = await newUser();
    const first = await invite(user.email);
    const second = await invite(user.email);
    expect(await acceptInvitation(user.id, first.token)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    await cancelInvitation(org, owner, second.id);
    expect(await acceptInvitation(user.id, second.token)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("another account cannot use the link, even knowing the token", async () => {
    const invited = await newUser();
    const thief = await newUser();
    const { token } = await invite(invited.email);
    expect(await acceptInvitation(thief.id, token)).toMatchObject({
      ok: false,
      reason: "wrong_account",
    });
    expect(
      await db.membership.count({
        where: { organizationId: org, userId: thief.id },
      }),
    ).toBe(0);
    // The link still works for the right person.
    expect(await acceptInvitation(invited.id, token)).toMatchObject({
      ok: true,
    });
  });

  it("an account with unconfirmed email cannot accept", async () => {
    const user = await newUser(address("sin-confirmar"), false);
    const { token } = await invite(user.email);
    expect(await acceptInvitation(user.id, token)).toMatchObject({
      ok: false,
      reason: "wrong_account",
    });
  });

  it("the hash stored in the database is useless as a token", async () => {
    const user = await newUser();
    const { token } = await invite(user.email);
    expect(
      await acceptInvitation(user.id, hashInvitationToken(token)),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("simultaneous acceptances create one membership", async () => {
    const user = await newUser();
    const { token } = await invite(user.email);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => acceptInvitation(user.id, token)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await db.membership.count({
        where: { organizationId: org, userId: user.id },
      }),
    ).toBe(1);
    expect((await loadSubject(org, user.id)).roles).toEqual(["warehouse"]);
  });
});

describe("acceptInvitationAsNewUser", () => {
  it(
    "creates a confirmed account that can sign in, and its membership",
    async () => {
      const email = address("nueva");
      const { token } = await invite(email, ["viewer"]);
      const result = await acceptInvitationAsNewUser(
        token,
        { name: "  Lupita Ramos ", password: PASSWORD },
        from(),
      );
      expect(result).toEqual({ ok: true, organizationId: org, email });

      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({ name: "Lupita Ramos", emailVerified: true });
      expect((await loadSubject(org, user.id)).roles).toEqual(["viewer"]);
      // No verification email: the link already proved the mailbox.
      expect(
        memoryOutboxFor(email).filter((m) => m.subject.includes("Confirma")),
      ).toHaveLength(0);

      const signedIn = await auth.api.signInEmail({
        body: { email, password: PASSWORD },
        headers: from(),
      });
      expect(signedIn.user.id).toBe(user.id);
    },
    SLOW,
  );

  it(
    "a used token cannot create a second account",
    async () => {
      const email = address("una-vez");
      const { token } = await invite(email);
      await acceptInvitationAsNewUser(
        token,
        { name: "Primera", password: PASSWORD },
        from(),
      );
      expect(
        await acceptInvitationAsNewUser(
          token,
          { name: "Segunda", password: PASSWORD },
          from(),
        ),
      ).toMatchObject({ ok: false, reason: "invalid" });
      expect(await db.user.count({ where: { email } })).toBe(1);
    },
    SLOW,
  );

  it("an expired token creates nothing", async () => {
    const email = address("vencida");
    const { id, token } = await invite(email);
    await db.invitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      await acceptInvitationAsNewUser(
        token,
        { name: "Tarde", password: PASSWORD },
        from(),
      ),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it(
    "an email that already has an account must sign in instead",
    async () => {
      const user = await newUser();
      const { token } = await invite(user.email);
      expect(
        await acceptInvitationAsNewUser(
          token,
          { name: "Impostor", password: PASSWORD },
          from(),
        ),
      ).toMatchObject({ ok: false, reason: "has_account" });
      expect(await db.account.count({ where: { userId: user.id } })).toBe(0);
      expect(
        await db.membership.count({
          where: { organizationId: org, userId: user.id },
        }),
      ).toBe(0);
      // The invitation is still there for the real owner.
      expect(await acceptInvitation(user.id, token)).toMatchObject({
        ok: true,
      });
    },
    SLOW,
  );

  it("validates name and password without spending the link", async () => {
    const email = address("campos");
    const { token } = await invite(email);
    expect(
      await acceptInvitationAsNewUser(
        token,
        { name: "", password: "corta" },
        from(),
      ),
    ).toMatchObject({
      ok: false,
      reason: "fields",
      fieldErrors: {
        name: expect.any(String),
        password: expect.any(String),
      },
    });
    expect(await previewInvitation(token)).not.toBeNull();
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it(
    "simultaneous submissions create one account and one membership",
    async () => {
      const email = address("carrera");
      const { token } = await invite(email);
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          acceptInvitationAsNewUser(
            token,
            { name: `Carrera ${i}`, password: PASSWORD },
            from(),
          ),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(await db.user.count({ where: { email } })).toBe(1);
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(await db.membership.count({ where: { userId: user.id } })).toBe(1);
      expect(await db.account.count({ where: { userId: user.id } })).toBe(1);
    },
    SLOW,
  );

  it(
    "limits attempts per IP",
    async () => {
      const ip = "203.0.113.77";
      let throttled = 0;
      for (let i = 0; i < 32; i++) {
        const result = await acceptInvitationAsNewUser(
          "token-inventado-con-forma-valida-0000000000",
          { name: "Bot", password: PASSWORD },
          from(ip),
        );
        if (!result.ok && result.reason === "throttled") throttled++;
      }
      expect(throttled).toBe(2);
    },
    SLOW,
  );
});
