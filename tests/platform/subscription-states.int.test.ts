import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { PERMISSIONS, createInvitation } from "@/platform/authorization";
import {
  assertModulePermission,
  deactivateModule,
  getPlanOverview,
  isReadOrExport,
  provisionCompany,
} from "@/platform/billing";
import {
  consumeQuota,
  getEntitlements,
  invalidateEntitlements,
  setEntitlementClock,
  type SubscriptionStatus,
} from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// MOD-11: subscription states and their effect. Expired → read and export
// only; the data stays intact.

const stamp = Date.now();
let counter = 0;
const DAY = 86_400_000;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `estados.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

/** Company with Inventario + Compras, valid for `days` (null = no end). */
async function company(days: number | null = null) {
  const owner = await newUser();
  const created = await createOrganization(owner, {
    name: `Empresa ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  const org = created.organizationId;
  if (!staff) {
    staff = await newUser();
    await db.platformStaff.create({ data: { userId: staff } });
  }
  const result = await provisionCompany(moduleRegistry, staff, org, {
    productLimit: 100,
    users: 5,
    modules: ["inventory", "purchasing"],
    validUntil: days === null ? null : new Date(Date.now() + days * DAY),
    reason: "Prueba de estados de suscripción",
  });
  if (!result.ok) throw new Error("provision failed");
  return { org, owner };
}

async function subscribe(org: string, status: SubscriptionStatus) {
  const plan = await db.planVersion.create({
    data: {
      id: newId(),
      tier: `st${stamp % 100000}x${++counter}`,
      version: 1,
      name: "Prueba",
      productLimit: 100,
      includedUsers: 5,
      extraUserPrice: "49.00",
      effectiveFrom: new Date(),
    },
  });
  await forOrganization(org).subscription.create({
    data: {
      id: newId(),
      organizationId: org,
      planVersionId: plan.id,
      status,
      currentPeriodStart: new Date(Date.now() - DAY),
      currentPeriodEnd: new Date(Date.now() + 29 * DAY),
    },
  });
  invalidateEntitlements(org);
}

let restoreClock: (() => void) | null = null;
/** Moves the clock of the entitlements forward: the plan "expires" without waiting. */
function afterDays(days: number) {
  restoreClock?.();
  restoreClock = setEntitlementClock(() => Date.now() + days * DAY);
}

const READS = PERMISSIONS.filter(
  (p) => !p.startsWith("platform.") && isReadOrExport(p),
);
const WRITES = PERMISSIONS.filter(
  (p) => !p.startsWith("platform.") && !isReadOrExport(p),
);

afterEach(() => {
  restoreClock?.();
  restoreClock = null;
  invalidateEntitlements();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("what counts as reading or exporting", () => {
  it("separates every business permission into look/export or write", () => {
    expect(READS).toContain("inventory.stock.read");
    expect(READS).toContain("inventory.export.create");
    expect(READS).toContain("purchasing.order.export");
    expect(READS).toContain("purchasing.report.export");
    expect(WRITES).toContain("inventory.product.create");
    expect(WRITES).toContain("inventory.import.create");
    expect(WRITES).toContain("purchasing.order.send");
    expect(WRITES).toContain("purchasing.receipt.create");
    expect(READS.length + WRITES.length).toBe(
      PERMISSIONS.filter((p) => !p.startsWith("platform.")).length,
    );
    // Nothing that reads or exports changes stock or documents.
    for (const permission of READS) {
      expect(permission).toMatch(/\.read$|\.export$|\.export\.create$/);
    }
  });
});

describe("an expired plan", () => {
  it("allows every read and export, and refuses every write", async () => {
    const { org, owner } = await company(30);
    await expect(
      assertModulePermission(org, owner, "inventory.product.create"),
    ).resolves.toBeUndefined();

    afterDays(31);
    for (const permission of READS) {
      await expect(
        assertModulePermission(org, owner, permission),
        permission,
      ).resolves.toBeUndefined();
    }
    for (const permission of WRITES) {
      await expect(
        assertModulePermission(org, owner, permission),
        permission,
      ).rejects.toMatchObject({
        kind: "forbidden",
        code: "module_read_only",
        message: expect.stringContaining("solo lectura"),
      });
    }
  });

  it("keeps the data intact: nothing is deleted or changed", async () => {
    const { org, owner } = await company(30);
    await consumeQuota(forOrganization(org), org, "active_products", 42);
    await createInvitation(org, owner, {
      email: `pendiente.${stamp}@example.test`,
      roles: ["viewer"],
    });
    const snapshot = async () => ({
      entitlements: await db.entitlement.count({
        where: { organizationId: org },
      }),
      quota: (
        await db.quotaUsage.findFirstOrThrow({
          where: { organizationId: org },
        })
      ).taken,
      members: await db.membership.count({ where: { organizationId: org } }),
      invitations: await db.invitation.count({
        where: { organizationId: org },
      }),
      audit: await db.auditEvent.count({ where: { organizationId: org } }),
    });
    const before = await snapshot();

    afterDays(31);
    await getEntitlements(org);
    await assertModulePermission(org, owner, "inventory.product.create").catch(
      () => undefined,
    );
    expect(await snapshot()).toEqual(before);
    expect(before.quota).toBe(42);
  });

  it("adds nothing: no products and no people", async () => {
    const { org, owner } = await company(30);
    // Really expired in the database, not only on the injected clock.
    await db.entitlement.updateMany({
      where: { organizationId: org },
      data: {
        validFrom: new Date(Date.now() - 2 * DAY),
        validUntil: new Date(Date.now() - DAY),
      },
    });
    invalidateEntitlements(org);
    expect(
      await consumeQuota(forOrganization(org), org, "active_products"),
    ).toMatchObject({ ok: false, limit: null });
    expect(
      await createInvitation(org, owner, {
        email: `tarde.${stamp}@example.test`,
        roles: ["viewer"],
      }),
    ).toMatchObject({ ok: false });
  });

  it("shows as read-only in «Mi plan», and comes back when renewed", async () => {
    const { org, owner } = await company(30);
    await db.entitlement.updateMany({
      where: { organizationId: org },
      data: {
        validFrom: new Date(Date.now() - 2 * DAY),
        validUntil: new Date(Date.now() - DAY),
      },
    });
    invalidateEntitlements(org);
    const expired = await getPlanOverview(moduleRegistry, org);
    expect(expired).toMatchObject({
      hasPlan: true,
      status: "read_only",
      validUntil: null,
    });
    expect(
      expired.modules.filter((m) => m.state === "read_only").map((m) => m.id),
    ).toEqual(["inventory", "purchasing"]);

    await provisionCompany(moduleRegistry, staff, org, {
      productLimit: 100,
      users: 5,
      modules: ["inventory", "purchasing"],
      validUntil: null,
      reason: "Renovación pagada",
    });
    expect((await getPlanOverview(moduleRegistry, org)).status).toBe("active");
    await expect(
      assertModulePermission(org, owner, "inventory.product.create"),
    ).resolves.toBeUndefined();
  });

  it("a company that never had the module sees nothing of it", async () => {
    const owner = await newUser();
    const created = await createOrganization(owner, {
      name: "Sin plan",
      timeZone: "",
    });
    if (!created.ok) throw new Error("company setup failed");
    await expect(
      assertModulePermission(
        created.organizationId,
        owner,
        "inventory.product.read",
      ),
    ).rejects.toMatchObject({ code: "module_not_contracted" });
    expect(
      (await getPlanOverview(moduleRegistry, created.organizationId)).status,
    ).toBe("none");
  });
});

describe("a module that was removed", () => {
  it("keeps its history readable and exportable, without new operations", async () => {
    const { org, owner } = await company();
    await deactivateModule(moduleRegistry, {
      organizationId: org,
      moduleId: "purchasing",
      actorUserId: null,
    });
    for (const permission of READS.filter((p) => p.startsWith("purchasing."))) {
      await expect(
        assertModulePermission(org, owner, permission),
        permission,
      ).resolves.toBeUndefined();
    }
    for (const permission of WRITES.filter((p) =>
      p.startsWith("purchasing."),
    )) {
      await expect(
        assertModulePermission(org, owner, permission),
        permission,
      ).rejects.toMatchObject({ code: "module_read_only" });
    }
    // Inventario is untouched.
    await expect(
      assertModulePermission(org, owner, "inventory.entry.create"),
    ).resolves.toBeUndefined();
    const plan = await getPlanOverview(moduleRegistry, org);
    expect(plan.status).toBe("active");
    expect(plan.modules.find((m) => m.id === "purchasing")?.state).toBe(
      "read_only",
    );
  });
});

describe("effect of each subscription status", () => {
  it.each(["TRIAL", "ACTIVE"] as const)("%s: full use", async (status) => {
    const { org, owner } = await company();
    await subscribe(org, status);
    await expect(
      assertModulePermission(org, owner, "purchasing.order.create"),
    ).resolves.toBeUndefined();
    const entitlements = await getEntitlements(org);
    expect(entitlements).toMatchObject({
      subscriptionStatus: status,
      paymentNotice: false,
    });
  });

  it.each(["PAST_DUE", "GRACE"] as const)(
    "%s: full use with a notice to pay",
    async (status) => {
      const { org, owner } = await company();
      await subscribe(org, status);
      await expect(
        assertModulePermission(org, owner, "inventory.adjustment.create"),
      ).resolves.toBeUndefined();
      expect((await getEntitlements(org)).paymentNotice).toBe(true);
      expect(await getPlanOverview(moduleRegistry, org)).toMatchObject({
        status: "active",
        paymentNotice: true,
      });
    },
  );

  it.each(["SUSPENDED", "CANCELLED"] as const)(
    "%s: read and export only, even with valid entitlements",
    async (status) => {
      const { org, owner } = await company();
      await subscribe(org, status);
      await expect(
        assertModulePermission(org, owner, "inventory.stock.read"),
      ).resolves.toBeUndefined();
      await expect(
        assertModulePermission(org, owner, "inventory.export.create"),
      ).resolves.toBeUndefined();
      await expect(
        assertModulePermission(org, owner, "inventory.entry.create"),
      ).rejects.toMatchObject({ code: "module_read_only" });
      await expect(
        assertModulePermission(org, owner, "purchasing.order.create"),
      ).rejects.toMatchObject({ code: "module_read_only" });
      const entitlements = await getEntitlements(org);
      expect([...entitlements.modules]).toEqual([]);
      expect([...entitlements.readOnlyModules].sort()).toEqual([
        "inventory",
        "purchasing",
      ]);
      expect(entitlements.limit("active_products")).toBeNull();
      expect((await getPlanOverview(moduleRegistry, org)).status).toBe(
        "read_only",
      );
      // The rights themselves were not touched.
      expect(
        await db.entitlement.count({
          where: { organizationId: org, validUntil: null },
        }),
      ).toBe(4);
    },
  );

  it("the status of one company does not affect another", async () => {
    const suspended = await company();
    const healthy = await company();
    await subscribe(suspended.org, "SUSPENDED");
    await expect(
      assertModulePermission(
        healthy.org,
        healthy.owner,
        "inventory.entry.create",
      ),
    ).resolves.toBeUndefined();
  });

  it("team and settings stay available in read-only", async () => {
    const { org, owner } = await company();
    await subscribe(org, "CANCELLED");
    for (const permission of [
      "platform.team.read",
      "platform.audit.read",
      "platform.plan.read",
      "platform.subscription.create",
    ] as const) {
      await expect(
        assertModulePermission(org, owner, permission),
      ).resolves.toBeUndefined();
    }
  });
});
