import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { listAuditTrail } from "@/platform/audit";
import {
  activateModule,
  assertModulePermission,
  createModuleRegistry,
  deactivateModule,
  type ModuleContract,
} from "@/platform/billing";
import {
  getEntitlements,
  invalidateEntitlements,
} from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// MOD-06: modules are turned on and off respecting their dependencies.
// Inventario cannot be removed while Compras is active.

const stamp = Date.now();
let counter = 0;

async function newCompany() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Titular",
      email: `modulos.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const created = await createOrganization(user.id, {
    name: `Empresa ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  return { org: created.organizationId, owner: user.id };
}

const change = (organizationId: string, moduleId: string) => ({
  organizationId,
  moduleId,
  actorUserId: null,
});

const activeModules = async (org: string) =>
  [...(await getEntitlements(org)).modules].sort();

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("activateModule", () => {
  it("activates the base, then a module that depends on it", async () => {
    const { org, owner } = await newCompany();
    expect(
      await activateModule(moduleRegistry, change(org, "inventory")),
    ).toEqual({ ok: true });
    expect(
      await activateModule(moduleRegistry, change(org, "purchasing")),
    ).toEqual({ ok: true });
    expect(await activeModules(org)).toEqual(["inventory", "purchasing"]);
    // The guard sees it right away (the cache was invalidated).
    await expect(
      assertModulePermission(org, owner, "purchasing.order.create"),
    ).resolves.toBeUndefined();
  });

  it("refuses a module whose dependency is not active", async () => {
    const { org } = await newCompany();
    expect(
      await activateModule(moduleRegistry, change(org, "purchasing")),
    ).toEqual({
      ok: false,
      reason: "missing_dependencies",
      error: "Compras necesita Inventario. Actívalo primero.",
      modules: ["Inventario"],
    });
    expect(await activeModules(org)).toEqual([]);
  });

  it.each(["sales", "crm"])(
    "refuses %s: announced but not available",
    async (moduleId) => {
      const { org } = await newCompany();
      await activateModule(moduleRegistry, change(org, "inventory"));
      expect(
        await activateModule(moduleRegistry, change(org, moduleId)),
      ).toMatchObject({ ok: false, reason: "unavailable" });
      expect(await activeModules(org)).toEqual(["inventory"]);
    },
  );

  it("refuses unknown modules and unknown companies", async () => {
    const { org } = await newCompany();
    expect(
      await activateModule(moduleRegistry, change(org, "payroll")),
    ).toMatchObject({ ok: false, reason: "unknown_module" });
    expect(
      await activateModule(moduleRegistry, change(newId(), "inventory")),
    ).toMatchObject({ ok: false, reason: "unknown_company" });
  });

  it("activating twice changes nothing the second time", async () => {
    const { org } = await newCompany();
    await activateModule(moduleRegistry, change(org, "inventory"));
    expect(
      await activateModule(moduleRegistry, change(org, "inventory")),
    ).toMatchObject({ ok: false, reason: "unchanged" });
    expect(
      await db.entitlement.count({
        where: { organizationId: org, key: "inventory" },
      }),
    ).toBe(1);
  });

  it("can be granted until a date, and extended", async () => {
    const { org } = await newCompany();
    const until = new Date(Date.now() + 86_400_000);
    await activateModule(moduleRegistry, {
      ...change(org, "inventory"),
      validUntil: until,
    });
    const row = () =>
      db.entitlement.findFirstOrThrow({
        where: { organizationId: org, key: "inventory" },
      });
    const first = await row();
    expect(first.validUntil?.getTime()).toBe(until.getTime());
    expect(
      await activateModule(moduleRegistry, change(org, "inventory")),
    ).toEqual({ ok: true });
    const extended = await row();
    expect(extended.validUntil).toBeNull();
    expect(extended.validFrom.getTime()).toBe(first.validFrom.getTime());
  });

  it("one company's modules do not appear in another", async () => {
    const a = await newCompany();
    const b = await newCompany();
    await activateModule(moduleRegistry, change(a.org, "inventory"));
    expect(await activeModules(b.org)).toEqual([]);
  });
});

describe("deactivateModule", () => {
  async function companyWithBoth() {
    const company = await newCompany();
    await activateModule(moduleRegistry, change(company.org, "inventory"));
    await activateModule(moduleRegistry, change(company.org, "purchasing"));
    return company;
  }

  it("Inventario cannot be removed while Compras is active", async () => {
    const { org } = await companyWithBoth();
    expect(
      await deactivateModule(moduleRegistry, change(org, "inventory")),
    ).toEqual({
      ok: false,
      reason: "has_dependents",
      error: "No se puede quitar Inventario mientras Compras esté activo.",
      modules: ["Compras"],
    });
    expect(await activeModules(org)).toEqual(["inventory", "purchasing"]);
  });

  it("Compras can be removed; its actions stop at once and Inventario stays", async () => {
    const { org, owner } = await companyWithBoth();
    expect(
      await deactivateModule(moduleRegistry, change(org, "purchasing")),
    ).toEqual({ ok: true });
    expect(await activeModules(org)).toEqual(["inventory"]);
    await expect(
      assertModulePermission(org, owner, "purchasing.order.create"),
    ).rejects.toMatchObject({ code: "module_not_contracted" });
    await expect(
      assertModulePermission(org, owner, "inventory.product.read"),
    ).resolves.toBeUndefined();
    // The right is closed, not erased: its history stays.
    const row = await db.entitlement.findFirstOrThrow({
      where: { organizationId: org, key: "purchasing" },
    });
    expect(row.validUntil).not.toBeNull();
  });

  it("the base cannot be removed even when nothing depends on it", async () => {
    const { org } = await newCompany();
    await activateModule(moduleRegistry, change(org, "inventory"));
    expect(
      await deactivateModule(moduleRegistry, change(org, "inventory")),
    ).toMatchObject({
      ok: false,
      reason: "required",
      error: "Inventario es la base de la empresa y no se puede quitar.",
    });
    expect(await activeModules(org)).toEqual(["inventory"]);
  });

  it("removing what is not active changes nothing", async () => {
    const { org } = await newCompany();
    await activateModule(moduleRegistry, change(org, "inventory"));
    expect(
      await deactivateModule(moduleRegistry, change(org, "purchasing")),
    ).toMatchObject({ ok: false, reason: "unchanged" });
    expect(
      await deactivateModule(moduleRegistry, change(org, "payroll")),
    ).toMatchObject({ ok: false, reason: "unknown_module" });
  });

  it("a removed module can be activated again", async () => {
    const { org } = await companyWithBoth();
    await deactivateModule(moduleRegistry, change(org, "purchasing"));
    expect(
      await activateModule(moduleRegistry, change(org, "purchasing")),
    ).toEqual({ ok: true });
    expect(await activeModules(org)).toEqual(["inventory", "purchasing"]);
    expect(
      await db.entitlement.count({
        where: { organizationId: org, key: "purchasing" },
      }),
    ).toBe(1);
  });

  it("names every active module that depends on it, direct or not", async () => {
    const contract = (
      id: string,
      name: string,
      dependsOn: string[],
      required = false,
    ): ModuleContract => ({
      id,
      name,
      version: "1.0.0",
      availability: "available",
      required,
      dependsOn,
      uses: [],
      permissions: required ? ["inventory.product.read"] : [],
      limits: [],
    });
    const registry = createModuleRegistry([
      contract("inventory", "Inventario", [], true),
      {
        ...contract("purchasing", "Compras", ["inventory"]),
        permissions: ["purchasing.order.read"],
      },
      {
        ...contract("returns", "Devoluciones", ["purchasing"]),
        availability: "unavailable",
      },
    ]);
    // "returns" cannot be activated (unavailable); grant it directly to
    // prove that indirect dependents are found.
    const { org } = await newCompany();
    await activateModule(registry, change(org, "inventory"));
    await activateModule(registry, change(org, "purchasing"));
    await db.entitlement.create({
      data: {
        id: newId(),
        organizationId: org,
        kind: "MODULE",
        key: "returns",
        validFrom: new Date(Date.now() - 1000),
      },
    });
    expect(
      await deactivateModule(registry, change(org, "inventory")),
    ).toMatchObject({
      reason: "has_dependents",
      modules: ["Compras", "Devoluciones"],
      error:
        "No se puede quitar Inventario mientras Compras y Devoluciones estén activos.",
    });
    expect(
      await deactivateModule(registry, change(org, "purchasing")),
    ).toMatchObject({ reason: "has_dependents", modules: ["Devoluciones"] });
  });

  it("removing Inventario while Compras is being activated never leaves Compras alone", async () => {
    const registry = createModuleRegistry(
      moduleRegistry.all
        .map((m) => ({ ...m, required: false }))
        .map((m) => (m.id === "inventory" ? { ...m, required: true } : m)),
    );
    for (let round = 0; round < 3; round++) {
      const { org } = await newCompany();
      await activateModule(registry, change(org, "inventory"));
      await Promise.all([
        activateModule(registry, change(org, "purchasing")),
        deactivateModule(registry, change(org, "inventory")),
      ]);
      invalidateEntitlements(org);
      const active = await activeModules(org);
      expect(
        !active.includes("purchasing") || active.includes("inventory"),
      ).toBe(true);
    }
  });
});

describe("audit", () => {
  it("records who turned a module on or off and why", async () => {
    const { org, owner } = await newCompany();
    await activateModule(moduleRegistry, {
      ...change(org, "inventory"),
      actorUserId: owner,
      reason: "Piloto pagado por SPEI",
    });
    await activateModule(moduleRegistry, change(org, "purchasing"));
    await deactivateModule(moduleRegistry, change(org, "purchasing"));
    await deactivateModule(moduleRegistry, change(org, "inventory"));

    const trail = (await listAuditTrail(org)).reverse().slice(1);
    expect(trail.map((e) => [e.action, e.label])).toEqual([
      ["module.activated", "Se activó un módulo"],
      ["module.activated", "Se activó un módulo"],
      ["module.deactivated", "Se desactivó un módulo"],
    ]);
    expect(trail[0]).toMatchObject({
      actorName: "Titular",
      reason: "Piloto pagado por SPEI",
    });
    expect(trail[1]!.actorName).toBeNull();
  });
});
