import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  createOrganization,
  listMyOrganizations,
  resolveActiveOrganization,
  switchOrganization,
} from "@/platform/tenancy";
import { db } from "@/server";

// PLT-11: the active company lives on the session and is re-checked
// against an active membership every time; switching validates it too.

const stamp = Date.now();

async function newUser(label: string) {
  return db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `${label}.ctx.${stamp}@example.test`,
      emailVerified: true,
    },
  });
}

async function newSession(userId: string) {
  return db.session.create({
    data: {
      id: newId(),
      userId,
      token: randomBytes(24).toString("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
}

async function newCompany(ownerId: string, name: string) {
  const result = await createOrganization(ownerId, { name, timeZone: "" });
  if (!result.ok) throw new Error("company setup failed");
  return result.organizationId;
}

async function addMember(organizationId: string, userId: string) {
  return db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
}

let worker: Awaited<ReturnType<typeof newUser>>;
let esperanza = "";
let tornillo = "";
let ajena = "";

beforeAll(async () => {
  const [ana, beto, carla] = await Promise.all([
    newUser("ana"),
    newUser("beto"),
    newUser("carla"),
  ]);
  worker = await newUser("trabajador");
  esperanza = await newCompany(ana.id, "Ferretería La Esperanza");
  tornillo = await newCompany(beto.id, "Ferretería El Tornillo");
  ajena = await newCompany(carla.id, "Ferretería Ajena");
  // Worker joined La Esperanza first, then El Tornillo.
  await addMember(esperanza, worker.id);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await addMember(tornillo, worker.id);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("resolveActiveOrganization", () => {
  it("starts in the oldest company and saves it on the session", async () => {
    const session = await newSession(worker.id);
    const active = await resolveActiveOrganization(worker.id, session.id);
    expect(active).toMatchObject({
      id: esperanza,
      name: "Ferretería La Esperanza",
      timeZone: "America/Mexico_City",
      currency: "MXN",
      isOwner: false,
    });
    const saved = await db.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(saved.activeOrganizationId).toBe(esperanza);
  });

  it("marks the titular as owner", async () => {
    const ownerId = (
      await db.organization.findUniqueOrThrow({ where: { id: tornillo } })
    ).ownerUserId;
    const session = await newSession(ownerId);
    expect(
      (await resolveActiveOrganization(ownerId, session.id))?.isOwner,
    ).toBe(true);
  });

  it("ignores a session that belongs to someone else", async () => {
    const other = await newUser("intruso");
    const session = await newSession(worker.id);
    expect(await resolveActiveOrganization(other.id, session.id)).toBeNull();
  });

  it("is null for a person without companies", async () => {
    const loner = await newUser("solo");
    const session = await newSession(loner.id);
    expect(await resolveActiveOrganization(loner.id, session.id)).toBeNull();
  });
});

describe("switchOrganization", () => {
  it("switches to another company where the person is a member", async () => {
    const session = await newSession(worker.id);
    expect(await switchOrganization(worker.id, session.id, tornillo)).toEqual({
      ok: true,
    });
    expect((await resolveActiveOrganization(worker.id, session.id))?.id).toBe(
      tornillo,
    );
    expect((await listMyOrganizations(worker.id)).map((o) => o.id)).toEqual([
      esperanza,
      tornillo,
    ]);
  });

  it("refuses a company where the person is not a member, the same as an unknown id", async () => {
    const session = await newSession(worker.id);
    await switchOrganization(worker.id, session.id, tornillo);
    const foreign = await switchOrganization(worker.id, session.id, ajena);
    const unknown = await switchOrganization(worker.id, session.id, newId());
    expect(foreign).toEqual({
      ok: false,
      error: "No tienes acceso a esa empresa.",
    });
    expect(unknown).toEqual(foreign);
    expect((await resolveActiveOrganization(worker.id, session.id))?.id).toBe(
      tornillo,
    );
  });

  it("cannot change another person's session", async () => {
    const victim = await newSession(worker.id);
    const ownerId = (
      await db.organization.findUniqueOrThrow({ where: { id: ajena } })
    ).ownerUserId;
    expect(await switchOrganization(ownerId, victim.id, ajena)).toMatchObject({
      ok: false,
    });
    const row = await db.session.findUniqueOrThrow({
      where: { id: victim.id },
    });
    expect(row.activeOrganizationId).not.toBe(ajena);
  });

  it("re-checks the membership: a disabled one falls back to another company", async () => {
    const session = await newSession(worker.id);
    await switchOrganization(worker.id, session.id, tornillo);
    await db.membership.updateMany({
      where: { userId: worker.id, organizationId: tornillo },
      data: { status: "DISABLED" },
    });
    expect((await resolveActiveOrganization(worker.id, session.id))?.id).toBe(
      esperanza,
    );
    expect(
      await switchOrganization(worker.id, session.id, tornillo),
    ).toMatchObject({ ok: false });

    await db.membership.updateMany({
      where: { userId: worker.id },
      data: { status: "DISABLED" },
    });
    expect(await resolveActiveOrganization(worker.id, session.id)).toBeNull();
    const row = await db.session.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(row.activeOrganizationId).toBeNull();
  });
});
