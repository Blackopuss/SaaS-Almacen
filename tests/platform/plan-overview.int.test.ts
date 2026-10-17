import { afterAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { createInvitation } from "@/platform/authorization";
import {
  getPlanOverview,
  provisionCompany,
  usageLevel,
  usagePercent,
} from "@/platform/billing";
import { consumeQuota, reserveQuota } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// MOD-10: «Mi plan» shows quotas (products and users), modules and validity.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `miplan.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function newCompany() {
  const owner = await newUser();
  const created = await createOrganization(owner, {
    name: `Empresa ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  return { org: created.organizationId, owner };
}

async function provision(
  org: string,
  change: { modules?: string[]; validUntil?: Date | null } = {},
) {
  if (!staff) {
    staff = await newUser();
    await db.platformStaff.create({ data: { userId: staff } });
  }
  const result = await provisionCompany(moduleRegistry, staff, org, {
    productLimit: 100,
    users: 3,
    modules: change.modules ?? ["inventory", "purchasing"],
    validUntil: change.validUntil ?? null,
    reason: "Prueba de Mi plan",
  });
  if (!result.ok) throw new Error("provision failed");
}

afterAll(async () => {
  await db.$disconnect();
});

describe("getPlanOverview", () => {
  it("a company without a plan sees no quotas and no active modules", async () => {
    const { org } = await newCompany();
    const plan = await getPlanOverview(moduleRegistry, org);
    expect(plan.hasPlan).toBe(false);
    expect(plan.validUntil).toBeNull();
    expect(plan.products).toMatchObject({ limit: null, used: 0 });
    expect(plan.seats).toMatchObject({ limit: null, members: 1 });
    expect(plan.modules.map((m) => [m.id, m.state])).toEqual([
      ["inventory", "available"],
      ["purchasing", "available"],
      ["sales", "unavailable"],
      ["crm", "unavailable"],
    ]);
  });

  it("shows quotas with their use, counting reservations and pending invitations", async () => {
    const { org, owner } = await newCompany();
    await provision(org);
    await consumeQuota(forOrganization(org), org, "active_products", 84);
    await reserveQuota(forOrganization(org), org, "active_products", 6);
    await createInvitation(org, owner, {
      email: `invitada.${stamp}@example.test`,
      roles: ["viewer"],
    });

    const plan = await getPlanOverview(moduleRegistry, org);
    expect(plan.hasPlan).toBe(true);
    expect(plan.products).toEqual({
      limit: 100,
      used: 84,
      reserved: 6,
      available: 10,
    });
    expect(plan.seats).toEqual({
      limit: 3,
      members: 1,
      pendingInvitations: 1,
      available: 1,
    });
  });

  it("shows active modules, what could be added and what is announced", async () => {
    const { org } = await newCompany();
    await provision(org, { modules: ["inventory"] });
    const plan = await getPlanOverview(moduleRegistry, org);
    expect(plan.modules.map((m) => ({ name: m.name, state: m.state }))).toEqual(
      [
        { name: "Inventario", state: "active" },
        { name: "Compras", state: "available" },
        { name: "Ventas", state: "unavailable" },
        { name: "CRM", state: "unavailable" },
      ],
    );
    expect(plan.modules[0]).toMatchObject({ required: true, validUntil: null });
  });

  it("shows until when the plan is valid", async () => {
    const { org } = await newCompany();
    const until = new Date(Date.now() + 15 * 86_400_000);
    await provision(org, { validUntil: until });
    const plan = await getPlanOverview(moduleRegistry, org);
    expect(plan.validUntil?.getTime()).toBe(until.getTime());
    expect(
      plan.modules.find((m) => m.id === "purchasing")?.validUntil?.getTime(),
    ).toBe(until.getTime());
  });

  it("never mixes another company's plan", async () => {
    const a = await newCompany();
    const b = await newCompany();
    await provision(a.org);
    await consumeQuota(forOrganization(a.org), a.org, "active_products", 50);
    const plan = await getPlanOverview(moduleRegistry, b.org);
    expect(plan.hasPlan).toBe(false);
    expect(plan.products.used).toBe(0);
  });
});

describe("usage warnings", () => {
  it("warns at 80%, 90% and 100%", () => {
    expect(usageLevel(79, 100)).toBe("ok");
    expect(usageLevel(80, 100)).toBe("high");
    expect(usageLevel(89, 100)).toBe("high");
    expect(usageLevel(90, 100)).toBe("almost");
    expect(usageLevel(99, 100)).toBe("almost");
    expect(usageLevel(100, 100)).toBe("full");
    expect(usageLevel(140, 100)).toBe("full");
    expect(usageLevel(5, null)).toBe("ok");
    expect(usageLevel(0, 0)).toBe("full");
  });

  it("the bar never leaves 0–100", () => {
    expect(usagePercent(84, 100)).toBe(84);
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(250, 100)).toBe(100);
    expect(usagePercent(0, 100)).toBe(0);
    expect(usagePercent(0, null)).toBe(0);
    expect(usagePercent(3, null)).toBe(100);
    expect(usagePercent(-5, 100)).toBe(0);
  });
});
