import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  listAuditEvents,
  listSecurityEvents,
  recordAuditEvent,
  recordSecurityEvent,
} from "@/platform/audit";
import { revokeOtherSessions } from "@/platform/auth";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// PLT-14: sensitive changes record actor, company and reason, without
// secrets, and the log cannot be changed or deleted afterwards.

const stamp = Date.now();
let ana = "";
let beto = "";
let orgA = "";
let orgB = "";

async function newUser(label: string) {
  return (
    await db.user.create({
      data: {
        id: newId(),
        name: label,
        email: `${label}.audit.${stamp}@example.test`,
        emailVerified: true,
      },
    })
  ).id;
}

async function company(ownerId: string, name: string) {
  const result = await createOrganization(ownerId, { name, timeZone: "" });
  if (!result.ok) throw new Error("company setup failed");
  return result.organizationId;
}

beforeAll(async () => {
  ana = await newUser("ana");
  beto = await newUser("beto");
  orgA = await company(ana, "Bitácora A");
  orgB = await company(beto, "Bitácora B");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("company events", () => {
  it("creating a company records who did it, in that company", async () => {
    const [event] = await listAuditEvents(forOrganization(orgA));
    expect(event).toMatchObject({
      actorUserId: ana,
      action: "organization.created",
      targetType: "organization",
      targetId: orgA,
      metadata: { name: "Bitácora A", timeZone: "America/Mexico_City" },
    });
  });

  it("stores actor, target and reason, and drops secrets from metadata", async () => {
    const scoped = forOrganization(orgA);
    await recordAuditEvent(scoped, {
      organizationId: orgA,
      actorUserId: ana,
      action: "inventory.adjustment",
      target: { type: "product", id: "SKU-1" },
      reason: "  Conteo físico encontró 3 piezas menos  ",
      metadata: { before: 10, after: 7, password: "nunca", token: "nunca" },
      ipAddress: "203.0.113.5",
    });
    const [event] = await listAuditEvents(scoped, { limit: 1 });
    expect(event).toMatchObject({
      action: "inventory.adjustment",
      reason: "Conteo físico encontró 3 piezas menos",
      metadata: { before: 10, after: 7 },
    });
    expect(JSON.stringify(event)).not.toContain("nunca");
  });

  it("rejects malformed action names", async () => {
    await expect(
      recordAuditEvent(forOrganization(orgA), {
        organizationId: orgA,
        actorUserId: ana,
        action: "Borrar todo",
      }),
    ).rejects.toThrow(/Invalid audit action/);
  });

  it("only shows each company its own log", async () => {
    const eventsB = await listAuditEvents(forOrganization(orgB));
    expect(eventsB.length).toBeGreaterThan(0);
    const ids = (
      await db.auditEvent.findMany({ where: { organizationId: orgA } })
    ).map((e) => e.id);
    expect(eventsB.some((e) => ids.includes(e.id))).toBe(false);
  });

  it("is written with the change: a failed transaction leaves no record", async () => {
    const before = await db.auditEvent.count({
      where: { organizationId: orgA },
    });
    await expect(
      db.$transaction(async (tx) => {
        await recordAuditEvent(tx, {
          organizationId: orgA,
          actorUserId: ana,
          action: "inventory.adjustment",
        });
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await db.auditEvent.count({ where: { organizationId: orgA } })).toBe(
      before,
    );
  });
});

describe("append-only", () => {
  it("company events cannot be changed or deleted, not even with raw SQL", async () => {
    const event = await db.auditEvent.findFirstOrThrow({
      where: { organizationId: orgA },
    });
    await expect(
      db.auditEvent.update({
        where: { id: event.id },
        data: { action: "nada.paso" },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.auditEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRawUnsafe("DELETE FROM audit_event WHERE id = ?", event.id),
    ).rejects.toThrow(/append-only/);
  });

  it("security events cannot be changed or deleted either", async () => {
    await recordSecurityEvent({ userId: ana, action: "session.revoked" });
    const event = await db.securityEvent.findFirstOrThrow({
      where: { userId: ana },
    });
    await expect(
      db.$executeRawUnsafe(
        "UPDATE security_event SET action = 'x.y' WHERE id = ?",
        event.id,
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.securityEvent.deleteMany({ where: { userId: ana } }),
    ).rejects.toThrow(/append-only/);
  });
});

describe("account security events", () => {
  it("closing other sessions is recorded with the count", async () => {
    const current = newId();
    for (const id of [current, newId(), newId()]) {
      await db.session.create({
        data: {
          id,
          userId: beto,
          token: randomBytes(24).toString("hex"),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
    }
    expect(await revokeOtherSessions(beto, current)).toBe(2);
    const [event] = await listSecurityEvents(beto, 1);
    expect(event).toMatchObject({
      action: "session.revoked_others",
      metadata: { count: 2 },
    });
  });

  it("a failure to record never breaks the operation", async () => {
    await expect(
      recordSecurityEvent({
        userId: "x".repeat(80), // too long for the column
        action: "session.revoked",
      }),
    ).resolves.toBeUndefined();
  });
});
