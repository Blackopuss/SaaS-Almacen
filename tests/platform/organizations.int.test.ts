import { afterAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { isMfaRequired } from "@/platform/auth";
import { createOrganization, hasOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// PLT-10: a company and its titular's membership are created together or
// not at all, and an account gets at most one company here.

const stamp = Date.now();

async function newUser(label: string) {
  return db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `${label}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
}

afterAll(async () => {
  await db.$disconnect();
});

describe("createOrganization", () => {
  it("creates the company with the person as titular and member", async () => {
    const user = await newUser("titular");
    expect(await hasOrganization(user.id)).toBe(false);

    const result = await createOrganization(user.id, {
      name: "  Ferretería La Esperanza  ",
      timeZone: "America/Tijuana",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const org = await db.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
      include: { memberships: true },
    });
    expect(org).toMatchObject({
      name: "Ferretería La Esperanza",
      timeZone: "America/Tijuana",
      currency: "MXN",
      ownerUserId: user.id,
    });
    expect(org.memberships).toEqual([
      expect.objectContaining({ userId: user.id, status: "ACTIVE" }),
    ]);
    // Titular from now on: MFA becomes mandatory (PLT-08B).
    expect(await isMfaRequired(user.id)).toBe(true);
  });

  it("reports invalid fields in Spanish without creating anything", async () => {
    const user = await newUser("invalido");
    const before = await db.organization.count();
    expect(
      await createOrganization(user.id, {
        name: "A",
        timeZone: "Europe/Madrid",
      }),
    ).toEqual({
      ok: false,
      fieldErrors: {
        name: "Escribe el nombre de tu negocio (mínimo 2 caracteres).",
        timeZone: "Elige la zona horaria de tu negocio.",
      },
    });
    expect(await db.organization.count()).toBe(before);
  });

  it("uses Mexico City time when no zone is given", async () => {
    const user = await newUser("sinzona");
    const result = await createOrganization(user.id, {
      name: "Tlapalería Centro",
      timeZone: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const org = await db.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
    });
    expect(org.timeZone).toBe("America/Mexico_City");
  });

  it("refuses a second company for the same account", async () => {
    const user = await newUser("segunda");
    expect(
      (await createOrganization(user.id, { name: "Primera", timeZone: "" })).ok,
    ).toBe(true);
    expect(
      await createOrganization(user.id, { name: "Segunda", timeZone: "" }),
    ).toEqual({
      ok: false,
      fieldErrors: {},
      formError: "Tu cuenta ya pertenece a una empresa.",
    });
    expect(
      await db.organization.count({ where: { ownerUserId: user.id } }),
    ).toBe(1);
  });

  it("creates only one company when two submissions race", async () => {
    const user = await newUser("carrera");
    const results = await Promise.all([
      createOrganization(user.id, { name: "Carrera A", timeZone: "" }),
      createOrganization(user.id, { name: "Carrera B", timeZone: "" }),
      createOrganization(user.id, { name: "Carrera C", timeZone: "" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await db.organization.count({ where: { ownerUserId: user.id } }),
    ).toBe(1);
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(1);
  });

  it("leaves nothing behind when the transaction fails", async () => {
    const ghost = newId(); // no such user: the inserts fail
    const before = {
      orgs: await db.organization.count(),
      members: await db.membership.count(),
    };
    await expect(
      createOrganization(ghost, { name: "Fantasma", timeZone: "" }),
    ).rejects.toThrow();
    expect(await db.organization.count()).toBe(before.orgs);
    expect(await db.membership.count()).toBe(before.members);
  });
});

describe("hasOrganization", () => {
  it("ignores disabled memberships", async () => {
    const owner = await newUser("dueno");
    const result = await createOrganization(owner.id, {
      name: "Con equipo",
      timeZone: "",
    });
    if (!result.ok) throw new Error("setup failed");
    const member = await newUser("baja");
    await db.membership.create({
      data: {
        id: newId(),
        organizationId: result.organizationId,
        userId: member.id,
        status: "DISABLED",
      },
    });
    expect(await hasOrganization(member.id)).toBe(false);
  });
});
