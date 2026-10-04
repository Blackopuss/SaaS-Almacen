import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { listAuditTrail } from "@/platform/audit";
import { isMfaRequired } from "@/platform/auth";
import { createInvitation } from "@/platform/authorization";
import {
  assertModulePermission,
  getCompanyPlan,
  isPlatformStaff,
  listCompaniesForStaff,
  provisionCompany,
  type ProvisionInput,
} from "@/platform/billing";
import { consumeQuota, getEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// MOD-09: platform staff assign tier, modules and validity, with audit.

const stamp = Date.now();
let counter = 0;

async function newUser(name = "Persona") {
  return db.user.create({
    data: {
      id: newId(),
      name,
      email: `consola.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
}

async function newCompany(name = `Ferretería ${stamp}-${counter}`) {
  const owner = await newUser("Titular");
  const created = await createOrganization(owner.id, { name, timeZone: "" });
  if (!created.ok) throw new Error("company setup failed");
  return { org: created.organizationId, owner };
}

const plan = (change: Partial<ProvisionInput> = {}): ProvisionInput => ({
  productLimit: 1000,
  users: 5,
  modules: ["inventory", "purchasing"],
  validUntil: null,
  reason: "Pago SPEI del piloto, folio 123",
  ...change,
});

let staff = "";

beforeAll(async () => {
  staff = (await newUser("Soporte Almacén")).id;
  await db.platformStaff.create({ data: { userId: staff } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("platform staff", () => {
  it("is only who has an active row; being a titular is not enough", async () => {
    const { owner } = await newCompany();
    expect(await isPlatformStaff(staff)).toBe(true);
    expect(await isPlatformStaff(owner.id)).toBe(false);
    expect(await isPlatformStaff(newId())).toBe(false);
  });

  it("withdrawn staff lose access at once", async () => {
    const former = await newUser();
    await db.platformStaff.create({
      data: { userId: former.id, disabledAt: new Date() },
    });
    expect(await isPlatformStaff(former.id)).toBe(false);
    const { org } = await newCompany();
    expect(
      await provisionCompany(moduleRegistry, former.id, org, plan()),
    ).toMatchObject({ ok: false, formError: expect.any(String) });
  });

  it("must use MFA", async () => {
    const person = await newUser();
    expect(await isMfaRequired(person.id)).toBe(false);
    await db.platformStaff.create({ data: { userId: person.id } });
    // isMfaRequired is cached per request; ask for another account state.
    const again = await newUser();
    await db.platformStaff.create({ data: { userId: again.id } });
    expect(await isMfaRequired(again.id)).toBe(true);
  });
});

describe("provisionCompany", () => {
  it("assigns limits and modules, and the company can work at once", async () => {
    const { org, owner } = await newCompany();
    await expect(
      assertModulePermission(org, owner.id, "inventory.product.create"),
    ).rejects.toMatchObject({ code: "module_not_contracted" });

    expect(await provisionCompany(moduleRegistry, staff, org, plan())).toEqual({
      ok: true,
    });

    const entitlements = await getEntitlements(org);
    expect([...entitlements.modules].sort()).toEqual([
      "inventory",
      "purchasing",
    ]);
    expect(entitlements.limit("active_products")).toBe(1000);
    expect(entitlements.limit("users")).toBe(5);
    await expect(
      assertModulePermission(org, owner.id, "purchasing.order.create"),
    ).resolves.toBeUndefined();
    expect(
      (await consumeQuota(forOrganization(org), org, "active_products")).ok,
    ).toBe(true);
    expect(
      await createInvitation(org, owner.id, {
        email: `nuevo.${stamp}@example.test`,
        roles: ["viewer"],
      }),
    ).toMatchObject({ ok: true });
  });

  it("records who, what and why in the company's audit log", async () => {
    const { org } = await newCompany();
    await provisionCompany(moduleRegistry, staff, org, plan());
    const [event] = await listAuditTrail(org);
    expect(event).toMatchObject({
      action: "plan.provisioned",
      label: "Se asignó el plan de la empresa",
      actorName: "Soporte Almacén",
      reason: "Pago SPEI del piloto, folio 123",
    });
    const stored = await db.auditEvent.findFirstOrThrow({
      where: { organizationId: org, action: "plan.provisioned" },
    });
    expect(stored.metadata).toMatchObject({
      productLimit: 1000,
      users: 5,
      modules: ["Inventario", "Compras"],
      validUntil: null,
      byPlatformStaff: true,
    });
  });

  it("nobody but platform staff can provision: titular, administrator or stranger", async () => {
    const { org, owner } = await newCompany();
    const stranger = await newUser();
    for (const userId of [owner.id, stranger.id, newId()]) {
      expect(
        await provisionCompany(moduleRegistry, userId, org, plan()),
      ).toMatchObject({
        ok: false,
        formError: "No tienes permiso para hacer esto.",
      });
    }
    expect([...(await getEntitlements(org)).modules]).toEqual([]);
    expect(
      await db.auditEvent.count({
        where: { organizationId: org, action: "plan.provisioned" },
      }),
    ).toBe(0);
  });

  it("sets a validity; everything ends on that date", async () => {
    const { org } = await newCompany();
    const until = new Date(Date.now() + 30 * 86_400_000);
    await provisionCompany(
      moduleRegistry,
      staff,
      org,
      plan({ validUntil: until }),
    );
    const rows = await db.entitlement.findMany({
      where: { organizationId: org },
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.validUntil?.getTime() === until.getTime())).toBe(
      true,
    );
    expect((await getCompanyPlan(org))?.validUntil?.getTime()).toBe(
      until.getTime(),
    );
  });

  it("changing the plan replaces limits and closes removed modules without deleting", async () => {
    const { org, owner } = await newCompany();
    await provisionCompany(moduleRegistry, staff, org, plan());
    const before = await db.entitlement.findFirstOrThrow({
      where: { organizationId: org, key: "inventory" },
    });
    expect(
      await provisionCompany(
        moduleRegistry,
        staff,
        org,
        plan({ productLimit: 500, users: 3, modules: ["inventory"] }),
      ),
    ).toEqual({ ok: true });

    const company = await getCompanyPlan(org);
    expect(company).toMatchObject({
      modules: ["inventory"],
      productLimit: 500,
      users: 3,
      activeMembers: 1,
      validUntil: null,
    });
    await expect(
      assertModulePermission(org, owner.id, "purchasing.order.create"),
    ).rejects.toMatchObject({ code: "module_read_only" });
    const purchasing = await db.entitlement.findFirstOrThrow({
      where: { organizationId: org, key: "purchasing" },
    });
    expect(purchasing.validUntil).not.toBeNull();
    // What stayed in force keeps its original start.
    const after = await db.entitlement.findFirstOrThrow({
      where: { organizationId: org, key: "inventory" },
    });
    expect(after.validFrom.getTime()).toBe(before.validFrom.getTime());
    expect(
      await db.auditEvent.count({
        where: { organizationId: org, action: "plan.provisioned" },
      }),
    ).toBe(2);
  });

  it.each([
    [["purchasing"], "Compras necesita Inventario."],
    [[], "Inventario es la base y siempre va incluido."],
    [["inventory", "sales"], "Ventas todavía no está disponible."],
    [["inventory", "crm"], "CRM todavía no está disponible."],
    [["inventory", "payroll"], "Uno de los módulos no existe."],
  ])("rejects the modules %j", async (modules, message) => {
    const { org } = await newCompany();
    expect(
      await provisionCompany(moduleRegistry, staff, org, plan({ modules })),
    ).toEqual({ ok: false, fieldErrors: { modules: message } });
    expect(await db.entitlement.count({ where: { organizationId: org } })).toBe(
      0,
    );
  });

  it("validates amounts, validity and reason", async () => {
    const { org } = await newCompany();
    expect(
      await provisionCompany(
        moduleRegistry,
        staff,
        org,
        plan({
          productLimit: 0,
          users: "2.5",
          validUntil: new Date(Date.now() - 1000),
          reason: "ok",
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        productLimit: expect.any(String),
        users: expect.any(String),
        validUntil: expect.any(String),
        reason: expect.any(String),
      },
    });
    expect(
      await provisionCompany(
        moduleRegistry,
        staff,
        org,
        plan({ productLimit: "abc" }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { productLimit: expect.any(String) },
    });
  });

  it("an unknown company changes nothing", async () => {
    expect(
      await provisionCompany(moduleRegistry, staff, newId(), plan()),
    ).toMatchObject({ ok: false, formError: "Esa empresa no existe." });
  });

  it("provisioning one company does not touch another", async () => {
    const a = await newCompany();
    const b = await newCompany();
    await provisionCompany(moduleRegistry, staff, a.org, plan());
    expect(await getCompanyPlan(b.org)).toMatchObject({
      modules: [],
      productLimit: null,
      users: null,
    });
    expect(await listAuditTrail(b.org)).toHaveLength(1);
  });
});

describe("console lists", () => {
  it("finds companies by name or by the titular's email", async () => {
    const { org, owner } = await newCompany(`Tlapalería Única ${stamp}`);
    const byName = await listCompaniesForStaff(`Única ${stamp}`);
    expect(byName.map((c) => c.id)).toEqual([org]);
    const byEmail = await listCompaniesForStaff(owner.email.toUpperCase());
    expect(byEmail.map((c) => c.id)).toEqual([org]);
    expect(byEmail[0]).toMatchObject({
      ownerName: "Titular",
      ownerEmail: owner.email,
    });
    expect(await listCompaniesForStaff(`no-existe-${stamp}`)).toEqual([]);
    expect(await getCompanyPlan(newId())).toBeNull();
  });
});
