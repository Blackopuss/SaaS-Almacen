import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  INVITATION_DAYS,
  cancelInvitation,
  createInvitation,
  hashInvitationToken,
  listPendingInvitations,
  resendInvitation,
  type Role,
} from "@/platform/authorization";
import { memoryOutboxFor } from "@/platform/email";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// USR-04: an invitation carries a single-use token that expires and the
// roles chosen by someone allowed to hand them out.

const stamp = Date.now();
let counter = 0;
const address = (label: string) =>
  `${label}.${++counter}.inv.${stamp}@example.test`;

async function newUser(label: string) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: label,
      email: address(label),
      emailVerified: true,
    },
  });
  return user;
}

async function addMember(
  organizationId: string,
  userId: string,
  roles: Role[],
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
}

async function newCompany(name: string) {
  const owner = await newUser("titular");
  const created = await createOrganization(owner.id, { name, timeZone: "" });
  if (!created.ok) throw new Error("company setup failed");
  return { org: created.organizationId, owner: owner.id };
}

function tokenFrom(email: string): string {
  const messages = memoryOutboxFor(email);
  const url = messages[messages.length - 1]?.actionUrl ?? "";
  return new URL(url).searchParams.get("token") ?? "";
}

let org = "";
let owner = "";
let admin = "";
let other = { org: "", owner: "" };

beforeAll(async () => {
  ({ org, owner } = await newCompany("Ferretería La Esperanza"));
  other = await newCompany("Ferretería Ajena");
  admin = (await newUser("admin")).id;
  await addMember(org, admin, ["administrator"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("createInvitation", () => {
  it("emails a link whose token is stored only as a hash, with roles and expiry", async () => {
    const email = address("nuevo");
    const before = Date.now();
    const result = await createInvitation(org, owner, {
      email: `  ${email.toUpperCase()} `,
      roles: ["warehouse", "buyer"],
    });
    if (!result.ok) throw new Error("expected ok");

    const [message] = memoryOutboxFor(email);
    expect(message?.subject).toContain("Ferretería La Esperanza");
    expect(message?.text).toContain("Almacén y Comprador");
    const token = tokenFrom(email);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(message?.actionUrl).toContain("/invitacion?token=");

    const row = await db.invitation.findUniqueOrThrow({
      where: { id: result.invitationId },
    });
    expect(row).toMatchObject({
      organizationId: org,
      email,
      roles: ["warehouse", "buyer"],
      status: "PENDING",
      invitedByUserId: owner,
      tokenHash: hashInvitationToken(token),
    });
    expect(JSON.stringify(row)).not.toContain(token);
    const days = (row.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(INVITATION_DAYS - 0.01);
    expect(days).toBeLessThan(INVITATION_DAYS + 0.01);

    const audit = await db.auditEvent.findFirstOrThrow({
      where: { organizationId: org, targetId: result.invitationId },
    });
    expect(audit.action).toBe("team.invitation_created");
    expect(JSON.stringify(audit.metadata)).not.toContain(token);
  });

  it("every invitation has a different token", async () => {
    const a = address("a");
    const b = address("b");
    await createInvitation(org, owner, { email: a, roles: ["viewer"] });
    await createInvitation(org, owner, { email: b, roles: ["viewer"] });
    expect(tokenFrom(a)).not.toBe(tokenFrom(b));
  });

  it("inviting the same address again replaces the previous link", async () => {
    const email = address("repetido");
    await createInvitation(org, owner, { email, roles: ["viewer"] });
    const first = tokenFrom(email);
    await createInvitation(org, owner, { email, roles: ["buyer"] });
    const second = tokenFrom(email);
    expect(second).not.toBe(first);
    const rows = await db.invitation.findMany({
      where: { organizationId: org, email },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.status).sort()).toEqual(["CANCELLED", "PENDING"]);
    expect(rows.find((r) => r.status === "PENDING")?.tokenHash).toBe(
      hashInvitationToken(second),
    );
  });

  it("an administrator invites Almacén, Comprador or Consulta, never an administrator", async () => {
    expect(
      await createInvitation(org, admin, {
        email: address("por-admin"),
        roles: ["warehouse"],
      }),
    ).toMatchObject({ ok: true });
    const email = address("otro-admin");
    expect(
      await createInvitation(org, admin, { email, roles: ["administrator"] }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        roles:
          "Solo el titular puede nombrar, cambiar o quitar administradores.",
      },
    });
    expect(memoryOutboxFor(email)).toHaveLength(0);
    expect(
      await createInvitation(org, owner, { email, roles: ["administrator"] }),
    ).toMatchObject({ ok: true });
  });

  it.each(["warehouse", "buyer", "viewer"] as const)(
    "%s cannot invite",
    async (role) => {
      const user = await newUser(role);
      await addMember(org, user.id, [role]);
      const email = address("negado");
      expect(
        await createInvitation(org, user.id, { email, roles: ["viewer"] }),
      ).toMatchObject({
        ok: false,
        formError: "No tienes permiso para hacer esto.",
      });
      expect(memoryOutboxFor(email)).toHaveLength(0);
    },
  );

  it("the titular of another company cannot invite here", async () => {
    const email = address("ajeno");
    expect(
      await createInvitation(org, other.owner, { email, roles: ["viewer"] }),
    ).toMatchObject({ ok: false });
    expect(await db.invitation.count({ where: { email } })).toBe(0);
  });

  it.each([[[]], [["owner"]], [["titular"]], [["viewer", "viewer"]]])(
    "rejects roles %j",
    async (roles) => {
      expect(
        await createInvitation(org, owner, { email: address("rol"), roles }),
      ).toMatchObject({
        ok: false,
        fieldErrors: { roles: "Elige al menos un rol válido." },
      });
    },
  );

  it("rejects an invalid address", async () => {
    expect(
      await createInvitation(org, owner, {
        email: "no-es-correo",
        roles: ["viewer"],
      }),
    ).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
  });

  it("does not invite someone who already is in the team", async () => {
    const active = await newUser("activo");
    await addMember(org, active.id, ["viewer"]);
    const disabled = await newUser("baja");
    await addMember(org, disabled.id, ["viewer"], "DISABLED");
    expect(
      await createInvitation(org, owner, {
        email: active.email,
        roles: ["buyer"],
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { email: "Esta persona ya es parte de tu equipo." },
    });
    expect(
      await createInvitation(org, owner, {
        email: disabled.email,
        roles: ["buyer"],
      }),
    ).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String) } });
    expect(memoryOutboxFor(active.email)).toHaveLength(0);
  });

  it("a member of another company can be invited here", async () => {
    const outsider = await newUser("de-otra");
    await addMember(other.org, outsider.id, ["viewer"]);
    expect(
      await createInvitation(org, owner, {
        email: outsider.email,
        roles: ["viewer"],
      }),
    ).toMatchObject({ ok: true });
  });

  it("limits the invitations a company sends per hour", async () => {
    const company = await newCompany("Ferretería Insistente");
    let refused = 0;
    for (let i = 0; i < 22; i++) {
      const result = await createInvitation(company.org, company.owner, {
        email: address("masivo"),
        roles: ["viewer"],
      });
      if (!result.ok) {
        refused++;
        expect(result.formError).toMatch(/Demasiados intentos/);
      }
    }
    expect(refused).toBe(2);
    expect(
      await db.invitation.count({ where: { organizationId: company.org } }),
    ).toBe(20);
  });
});

describe("resendInvitation and cancelInvitation", () => {
  it("resending issues a new link and kills the old one", async () => {
    const email = address("reenvio");
    const created = await createInvitation(org, owner, {
      email,
      roles: ["buyer"],
    });
    if (!created.ok) throw new Error("expected ok");
    const first = tokenFrom(email);
    expect(await resendInvitation(org, admin, created.invitationId)).toEqual({
      ok: true,
    });
    const second = tokenFrom(email);
    expect(second).not.toBe(first);
    expect(
      await db.invitation.count({
        where: { tokenHash: hashInvitationToken(first), status: "PENDING" },
      }),
    ).toBe(0);
    const pending = await listPendingInvitations(org);
    expect(pending.find((i) => i.email === email)).toMatchObject({
      roles: ["buyer"],
      expired: false,
    });
  });

  it("cancelling leaves no pending invitation and is recorded", async () => {
    const email = address("cancelada");
    const created = await createInvitation(org, owner, {
      email,
      roles: ["viewer"],
    });
    if (!created.ok) throw new Error("expected ok");
    expect(await cancelInvitation(org, admin, created.invitationId)).toEqual({
      ok: true,
    });
    expect(
      await cancelInvitation(org, admin, created.invitationId),
    ).toMatchObject({ ok: false });
    expect(
      await resendInvitation(org, owner, created.invitationId),
    ).toMatchObject({ ok: false });
    expect(
      (await listPendingInvitations(org)).some((i) => i.email === email),
    ).toBe(false);
    expect(
      await db.auditEvent.count({
        where: {
          organizationId: org,
          action: "team.invitation_cancelled",
          targetId: created.invitationId,
        },
      }),
    ).toBe(1);
  });

  it("an administrator cannot resend or cancel an administrator's invitation", async () => {
    const created = await createInvitation(org, owner, {
      email: address("futuro-admin"),
      roles: ["administrator"],
    });
    if (!created.ok) throw new Error("expected ok");
    expect(
      await resendInvitation(org, admin, created.invitationId),
    ).toMatchObject({ ok: false });
    expect(
      await cancelInvitation(org, admin, created.invitationId),
    ).toMatchObject({ ok: false });
    expect(await cancelInvitation(org, owner, created.invitationId)).toEqual({
      ok: true,
    });
  });

  it("another company cannot resend, cancel or list this company's invitations", async () => {
    const email = address("aislada");
    const created = await createInvitation(org, owner, {
      email,
      roles: ["viewer"],
    });
    if (!created.ok) throw new Error("expected ok");
    expect(
      await resendInvitation(other.org, other.owner, created.invitationId),
    ).toMatchObject({ ok: false });
    expect(
      await cancelInvitation(other.org, other.owner, created.invitationId),
    ).toMatchObject({ ok: false });
    expect(
      (await listPendingInvitations(other.org)).some((i) => i.email === email),
    ).toBe(false);
    expect(
      (
        await db.invitation.findUniqueOrThrow({
          where: { id: created.invitationId },
        })
      ).status,
    ).toBe("PENDING");
  });

  it("people without the permission cannot resend or cancel", async () => {
    const viewer = await newUser("consulta");
    await addMember(org, viewer.id, ["viewer"]);
    const created = await createInvitation(org, owner, {
      email: address("protegida"),
      roles: ["viewer"],
    });
    if (!created.ok) throw new Error("expected ok");
    expect(
      await resendInvitation(org, viewer.id, created.invitationId),
    ).toMatchObject({ ok: false });
    expect(
      await cancelInvitation(org, viewer.id, created.invitationId),
    ).toMatchObject({ ok: false });
  });
});
