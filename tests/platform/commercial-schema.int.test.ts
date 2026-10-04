import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dec, newId } from "@/lib";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// MOD-03: commercial model with versioned prices. A plan version never
// changes once written; subscriptions keep the conditions they accepted.

const stamp = Date.now();
let counter = 0;
const tier = () => `t${stamp % 100000}x${++counter}`;
const now = () => new Date();
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

async function newCompany(name: string) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Titular",
      email: `comercial.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const created = await createOrganization(user.id, { name, timeZone: "" });
  if (!created.ok) throw new Error("company setup failed");
  return created.organizationId;
}

async function newPlan(
  tierCode: string,
  version: number,
  prices: Record<string, string>,
  change: { productLimit?: number; includedUsers?: number } = {},
) {
  return db.planVersion.create({
    data: {
      id: newId(),
      tier: tierCode,
      version,
      name: "1,000 productos",
      productLimit: change.productLimit ?? 1000,
      includedUsers: change.includedUsers ?? 5,
      extraUserPrice: "49.00",
      effectiveFrom: now(),
      modulePrices: {
        create: Object.entries(prices).map(([moduleId, monthlyPrice]) => ({
          id: newId(),
          moduleId,
          monthlyPrice,
        })),
      },
    },
    include: { modulePrices: true },
  });
}

async function subscribe(organizationId: string, planVersionId: string) {
  return forOrganization(organizationId).subscription.create({
    data: {
      id: newId(),
      organizationId,
      planVersionId,
      status: "ACTIVE",
      currentPeriodStart: now(),
      currentPeriodEnd: inDays(30),
    },
  });
}

let orgA = "";
let orgB = "";

beforeAll(async () => {
  orgA = await newCompany("Empresa A");
  orgB = await newCompany("Empresa B");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("plan versions", () => {
  it("stores prices as exact decimals", async () => {
    const plan = await newPlan(tier(), 1, {
      inventory: "349.00",
      purchasing: "179.00",
      cents: "0.10",
      more_cents: "0.20",
    });
    const price = (id: string) =>
      dec(
        plan.modulePrices
          .find((p) => p.moduleId === id)!
          .monthlyPrice.toString(),
      );
    expect(price("inventory").plus(price("purchasing")).toFixed(2)).toBe(
      "528.00",
    );
    expect(price("cents").plus(price("more_cents")).toFixed(2)).toBe("0.30");
    expect(plan.extraUserPrice.toString()).toBe("49");
  });

  it("a tier cannot have the same version twice", async () => {
    const code = tier();
    await newPlan(code, 1, { inventory: "349.00" });
    await expect(newPlan(code, 1, { inventory: "399.00" })).rejects.toThrow();
    await expect(
      newPlan(code, 2, { inventory: "399.00" }),
    ).resolves.toBeTruthy();
  });

  it("cannot be changed or deleted once written", async () => {
    const plan = await newPlan(tier(), 1, { inventory: "349.00" });
    await expect(
      db.planVersion.update({
        where: { id: plan.id },
        data: { productLimit: 5000 },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.planModulePrice.update({
        where: { id: plan.modulePrices[0]!.id },
        data: { monthlyPrice: "1.00" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRaw`UPDATE plan_module_price SET monthlyPrice = 1 WHERE planVersionId = ${plan.id}`,
    ).rejects.toThrow(/immutable/);
    await expect(
      db.planModulePrice.delete({ where: { id: plan.modulePrices[0]!.id } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.planVersion.delete({ where: { id: plan.id } }),
    ).rejects.toThrow();
    const stored = await db.planVersion.findUniqueOrThrow({
      where: { id: plan.id },
      include: { modulePrices: true },
    });
    expect(stored.productLimit).toBe(1000);
    expect(stored.modulePrices[0]!.monthlyPrice.toString()).toBe("349");
  });

  it.each([
    ["a quota of zero products", { productLimit: 0 }],
    ["no included users", { includedUsers: 0 }],
  ])("rejects %s", async (_label, change) => {
    await expect(newPlan(tier(), 1, {}, change)).rejects.toThrow(
      /plan_version_values_check/,
    );
  });

  it("rejects a negative price", async () => {
    await expect(newPlan(tier(), 1, { inventory: "-1.00" })).rejects.toThrow(
      /plan_module_price_value_check/,
    );
  });
});

describe("a new price is a new version", () => {
  it("existing subscriptions keep their conditions; the offer moves", async () => {
    const code = tier();
    const v1 = await newPlan(code, 1, { inventory: "349.00" });
    await db.planOffer.create({ data: { tier: code, planVersionId: v1.id } });
    const org = await newCompany("Cliente antiguo");
    const subscription = await subscribe(org, v1.id);
    await forOrganization(org).subscriptionItem.create({
      data: {
        id: newId(),
        organizationId: org,
        subscriptionId: subscription.id,
        moduleId: "inventory",
        monthlyPrice: v1.modulePrices[0]!.monthlyPrice,
        activeFrom: now(),
      },
    });

    const v2 = await newPlan(
      code,
      2,
      { inventory: "399.00" },
      { productLimit: 1200 },
    );
    await db.planOffer.update({
      where: { tier: code },
      data: { planVersionId: v2.id },
    });

    const kept = await forOrganization(org).subscription.findFirstOrThrow({
      include: { planVersion: true, items: true },
    });
    expect(kept.planVersion.version).toBe(1);
    expect(kept.planVersion.productLimit).toBe(1000);
    expect(kept.items[0]!.monthlyPrice.toString()).toBe("349");
    const offered = await db.planOffer.findUniqueOrThrow({
      where: { tier: code },
      include: { planVersion: { include: { modulePrices: true } } },
    });
    expect(offered.planVersion.version).toBe(2);
    expect(offered.planVersion.modulePrices[0]!.monthlyPrice.toString()).toBe(
      "399",
    );
  });
});

describe("subscriptions and their modules", () => {
  it("one subscription per company", async () => {
    const plan = await newPlan(tier(), 1, { inventory: "349.00" });
    await subscribe(orgA, plan.id);
    await expect(subscribe(orgA, plan.id)).rejects.toThrow();
    await expect(subscribe(orgB, plan.id)).resolves.toBeTruthy();
  });

  it("a module appears once per subscription", async () => {
    const subscription =
      await forOrganization(orgA).subscription.findFirstOrThrow();
    const item = {
      organizationId: orgA,
      subscriptionId: subscription.id,
      moduleId: "purchasing",
      monthlyPrice: "179.00",
      activeFrom: now(),
    };
    await forOrganization(orgA).subscriptionItem.create({
      data: { id: newId(), ...item },
    });
    await expect(
      forOrganization(orgA).subscriptionItem.create({
        data: { id: newId(), ...item },
      }),
    ).rejects.toThrow();
  });

  it("an item cannot point to the subscription of another company", async () => {
    const ofB = await forOrganization(orgB).subscription.findFirstOrThrow();
    await expect(
      db.$executeRaw`INSERT INTO subscription_item (id, organizationId, subscriptionId, moduleId, monthlyPrice, activeFrom)
        VALUES (${newId()}, ${orgA}, ${ofB.id}, 'crm', 99, UTC_TIMESTAMP(3))`,
    ).rejects.toThrow(/foreign key/i);
  });

  it("rejects a period that ends before it starts and negative extra users", async () => {
    const plan = await newPlan(tier(), 1, { inventory: "349.00" });
    const org = await newCompany("Periodos");
    const data = {
      id: newId(),
      organizationId: org,
      planVersionId: plan.id,
      currentPeriodStart: now(),
      currentPeriodEnd: inDays(-1),
    };
    await expect(
      forOrganization(org).subscription.create({ data }),
    ).rejects.toThrow(/subscription_values_check/);
    await expect(
      forOrganization(org).subscription.create({
        data: { ...data, currentPeriodEnd: inDays(30), extraUsers: -1 },
      }),
    ).rejects.toThrow(/subscription_values_check/);
  });

  it("a plan version in use cannot be removed", async () => {
    const subscription =
      await forOrganization(orgA).subscription.findFirstOrThrow();
    await expect(
      db.planVersion.delete({ where: { id: subscription.planVersionId } }),
    ).rejects.toThrow();
  });
});

describe("entitlements", () => {
  const grant = (organizationId: string, key: string) => ({
    id: newId(),
    organizationId,
    kind: "MODULE" as const,
    key,
    validFrom: now(),
  });

  it("a company holds each module and each limit once", async () => {
    await forOrganization(orgA).entitlement.create({
      data: grant(orgA, "inventory"),
    });
    await expect(
      forOrganization(orgA).entitlement.create({
        data: grant(orgA, "inventory"),
      }),
    ).rejects.toThrow();
    await forOrganization(orgA).entitlement.create({
      data: {
        ...grant(orgA, "active_products"),
        kind: "LIMIT",
        value: 1000,
      },
    });
    // The same keys in another company are independent.
    await expect(
      forOrganization(orgB).entitlement.create({
        data: grant(orgB, "inventory"),
      }),
    ).resolves.toBeTruthy();
    expect(await forOrganization(orgA).entitlement.count()).toBe(2);
    expect(await forOrganization(orgB).entitlement.count()).toBe(1);
  });

  it("a module carries no value; a limit needs one that is not negative", async () => {
    await expect(
      forOrganization(orgA).entitlement.create({
        data: { ...grant(orgA, "purchasing"), value: 1 },
      }),
    ).rejects.toThrow(/entitlement_value_check/);
    await expect(
      forOrganization(orgA).entitlement.create({
        data: { ...grant(orgA, "users"), kind: "LIMIT" },
      }),
    ).rejects.toThrow(/entitlement_value_check/);
    await expect(
      forOrganization(orgA).entitlement.create({
        data: { ...grant(orgA, "users"), kind: "LIMIT", value: -5 },
      }),
    ).rejects.toThrow(/entitlement_value_check/);
  });

  it("validity cannot end before it starts", async () => {
    await expect(
      forOrganization(orgA).entitlement.create({
        data: { ...grant(orgA, "purchasing"), validUntil: inDays(-1) },
      }),
    ).rejects.toThrow(/entitlement_period_check/);
  });

  it("cannot reference the subscription of another company", async () => {
    const ofB = await forOrganization(orgB).subscription.findFirstOrThrow();
    await expect(
      forOrganization(orgA).entitlement.create({
        data: { ...grant(orgA, "purchasing"), subscriptionId: ofB.id },
      }),
    ).rejects.toThrow();
  });
});
