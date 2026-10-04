import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { AUDIT_ACTION_LABELS, listAuditTrail } from "@/platform/audit";
import {
  acceptInvitation,
  acceptOwnershipTransfer,
  assignRoles,
  cancelInvitation,
  createInvitation,
  disableMember,
  offerOwnershipTransfer,
  reactivateMember,
  resendInvitation,
} from "@/platform/authorization";
import { memoryOutboxFor } from "@/platform/email";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

import { grantSeats } from "../setup/plan";

// USR-11: inviting, changing roles and disabling leave a record that the
// titular and administrators can read, and that nobody can change.

const stamp = Date.now();
let counter = 0;

async function newUser(name: string) {
  return db.user.create({
    data: {
      id: newId(),
      name,
      email: `auditoria.${++counter}.${stamp}@example.test`,
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
}

async function newCompany(name: string) {
  const owner = await newUser("Doña Esperanza");
  const created = await createOrganization(owner.id, { name, timeZone: "" });
  if (!created.ok) throw new Error("company setup failed");
  await grantSeats(created.organizationId);
  return { org: created.organizationId, owner: owner.id };
}

afterAll(async () => {
  await db.$disconnect();
});

describe("team changes leave a record", () => {
  it("records the whole life of a member, in order, with who and what", async () => {
    const { org, owner } = await newCompany("Ferretería La Esperanza");
    const lupita = await newUser("Lupita Ramos");

    const invitation = await createInvitation(org, owner, {
      email: lupita.email,
      roles: ["viewer"],
    });
    if (!invitation.ok) throw new Error("invitation failed");
    await resendInvitation(org, owner, invitation.invitationId);
    const url = memoryOutboxFor(lupita.email).at(-1)!.actionUrl!;
    await acceptInvitation(lupita.id, new URL(url).searchParams.get("token")!);
    await assignRoles(org, owner, {
      userId: lupita.id,
      roles: ["warehouse", "buyer"],
    });
    await disableMember(org, owner, {
      userId: lupita.id,
      reason: "Vacaciones largas",
    });
    await reactivateMember(org, owner, { userId: lupita.id });
    const cancelled = await createInvitation(org, owner, {
      email: `otra.${stamp}@example.test`,
      roles: ["administrator"],
    });
    if (!cancelled.ok) throw new Error("invitation failed");
    await cancelInvitation(org, owner, cancelled.invitationId);
    const offer = await offerOwnershipTransfer(org, owner, {
      toUserId: lupita.id,
    });
    if (!offer.ok) throw new Error("offer failed");
    await acceptOwnershipTransfer(org, lupita.id, offer.transferId);

    const trail = (await listAuditTrail(org, { limit: 200 })).reverse();
    expect(trail.map((e) => e.action)).toEqual([
      "organization.created",
      "team.invitation_created",
      "team.invitation_resent",
      "team.invitation_accepted",
      "team.roles_changed",
      "team.member_disabled",
      "team.member_reactivated",
      "team.invitation_created",
      "team.invitation_cancelled",
      "ownership.transfer_offered",
      "ownership.transferred",
    ]);

    const by = (action: string) => trail.filter((e) => e.action === action);
    expect(by("team.invitation_created")[0]).toMatchObject({
      label: "Invitó a una persona",
      actorName: "Doña Esperanza",
      email: lupita.email,
      rolesTo: ["viewer"],
    });
    expect(by("team.invitation_accepted")[0]).toMatchObject({
      actorName: "Lupita Ramos",
      email: lupita.email,
      rolesTo: ["viewer"],
    });
    expect(by("team.roles_changed")[0]).toMatchObject({
      actorName: "Doña Esperanza",
      targetName: "Lupita Ramos",
      rolesFrom: ["viewer"],
      rolesTo: ["buyer", "warehouse"],
    });
    expect(by("team.member_disabled")[0]).toMatchObject({
      targetName: "Lupita Ramos",
      reason: "Vacaciones largas",
    });
    expect(by("team.invitation_cancelled")[0]).toMatchObject({
      email: `otra.${stamp}@example.test`,
      rolesTo: ["administrator"],
    });
    expect(by("ownership.transferred")[0]).toMatchObject({
      actorName: "Lupita Ramos",
      rolesTo: ["viewer"],
    });
    // Nothing secret in what is shown.
    expect(JSON.stringify(trail)).not.toMatch(/token/i);
  });

  it("refused changes leave no record", async () => {
    const { org, owner } = await newCompany("Ferretería Tranquila");
    const outsider = await newUser("Ajeno");
    await createInvitation(org, outsider.id, {
      email: `no.${stamp}@example.test`,
      roles: ["viewer"],
    });
    await assignRoles(org, outsider.id, { userId: owner, roles: ["viewer"] });
    await disableMember(org, outsider.id, { userId: owner });
    await disableMember(org, owner, { userId: owner });
    expect((await listAuditTrail(org)).map((e) => e.action)).toEqual([
      "organization.created",
    ]);
  });

  it("the trail of a company never shows another company's events", async () => {
    const a = await newCompany("Empresa A");
    const b = await newCompany("Empresa B");
    await createInvitation(b.org, b.owner, {
      email: `b.${stamp}@example.test`,
      roles: ["viewer"],
    });
    const trail = await listAuditTrail(a.org);
    expect(trail).toHaveLength(1);
    expect(JSON.stringify(trail)).not.toContain(`b.${stamp}@example.test`);
  });

  it("a record cannot be changed or deleted, not even by the application", async () => {
    const { org } = await newCompany("Ferretería Intacta");
    const event = await db.auditEvent.findFirstOrThrow({
      where: { organizationId: org },
    });
    await expect(
      db.auditEvent.update({
        where: { id: event.id },
        data: { action: "team.nothing_happened" },
      }),
    ).rejects.toThrow();
    await expect(
      db.auditEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow();
  });

  it("pages through older events", async () => {
    const { org, owner } = await newCompany("Ferretería Larga");
    for (let i = 0; i < 3; i++) {
      await createInvitation(org, owner, {
        email: `pagina.${i}.${stamp}@example.test`,
        roles: ["viewer"],
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const first = await listAuditTrail(org, { limit: 2 });
    const rest = await listAuditTrail(org, {
      limit: 10,
      before: first.at(-1)!.createdAt,
    });
    expect(first).toHaveLength(2);
    expect(rest).toHaveLength(2);
    expect(rest.at(-1)!.action).toBe("organization.created");
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "generated" ? [] : sources(full);
    }
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [full] : [];
  });
}

describe("every company action has a sentence for people", () => {
  it("each action recorded with recordAuditEvent is in AUDIT_ACTION_LABELS", () => {
    const recorded = new Set<string>();
    for (const file of sources(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const call of source.matchAll(
        /recordAuditEvent\([\s\S]*?action:\s*"([a-z_.]+)"/g,
      )) {
        recorded.add(call[1]!);
      }
    }
    expect(recorded.size).toBeGreaterThanOrEqual(10);
    for (const action of recorded) {
      expect(AUDIT_ACTION_LABELS[action], action).toBeTruthy();
    }
  });
});
