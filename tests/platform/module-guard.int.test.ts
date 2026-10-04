import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { PERMISSIONS, type Role } from "@/platform/authorization";
import {
  assertModulePermission,
  assertWithinLimit,
  entitles,
  moduleOfPermission,
} from "@/platform/billing";
import {
  getEntitlements,
  getFreshEntitlements,
  invalidateEntitlements,
} from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// MOD-05: session → membership → role → module → limit. An action of a
// module that is not contracted is rejected even when it is called directly.

const stamp = Date.now();
let counter = 0;

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `guard.${++counter}.${stamp}@example.test`,
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

async function addMember(organizationId: string, roles: Role[]) {
  const userId = await newUser();
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  for (const role of roles) {
    await db.membershipRole.create({
      data: { id: newId(), organizationId, membershipId: membership.id, role },
    });
  }
  return userId;
}

async function grant(
  organizationId: string,
  key: string,
  options: { value?: number; until?: Date } = {},
) {
  await forOrganization(organizationId).entitlement.create({
    data: {
      id: newId(),
      organizationId,
      kind: options.value === undefined ? "MODULE" : "LIMIT",
      key,
      ...(options.value === undefined ? {} : { value: options.value }),
      validFrom: new Date(Date.now() - 60_000),
      validUntil: options.until ?? null,
    },
  });
  invalidateEntitlements(organizationId);
}

/** Company with Inventario only: Compras is not contracted. */
let basic = { org: "", owner: "" };
/** Company with Inventario and Compras. */
let full = { org: "", owner: "" };

beforeAll(async () => {
  basic = await newCompany();
  await grant(basic.org, "inventory");
  full = await newCompany();
  await grant(full.org, "inventory");
  await grant(full.org, "purchasing");
});

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("module of a permission", () => {
  it("is its first segment; platform permissions need no module", () => {
    expect(moduleOfPermission("inventory.product.read")).toBe("inventory");
    expect(moduleOfPermission("purchasing.order.create")).toBe("purchasing");
    expect(moduleOfPermission("platform.team.invite")).toBeNull();
    for (const permission of PERMISSIONS) {
      expect(["inventory", "purchasing", null]).toContain(
        moduleOfPermission(permission),
      );
    }
  });
});

describe("assertModulePermission", () => {
  it("passes with role and contracted module", async () => {
    await expect(
      assertModulePermission(full.org, full.owner, "purchasing.order.create"),
    ).resolves.toBeUndefined();
    await expect(
      assertModulePermission(
        basic.org,
        basic.owner,
        "inventory.product.create",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects every action of a module that is not contracted, even for the titular", async () => {
    for (const permission of PERMISSIONS.filter((p) =>
      p.startsWith("purchasing."),
    )) {
      await expect(
        assertModulePermission(basic.org, basic.owner, permission),
        permission,
      ).rejects.toMatchObject({
        kind: "forbidden",
        code: "module_not_contracted",
        message: "Tu empresa no tiene este módulo activo.",
        details: { module: "purchasing" },
      });
    }
  });

  it("a buyer in a company without Compras cannot buy", async () => {
    const buyer = await addMember(basic.org, ["buyer"]);
    await expect(
      assertModulePermission(basic.org, buyer, "purchasing.order.create"),
    ).rejects.toMatchObject({ code: "module_not_contracted" });
    // What Inventario gives the role still works.
    await expect(
      assertModulePermission(basic.org, buyer, "inventory.stock.read"),
    ).resolves.toBeUndefined();
  });

  it("the role is checked before the module: no hint about the plan", async () => {
    const warehouse = await addMember(basic.org, ["warehouse"]);
    await expect(
      assertModulePermission(basic.org, warehouse, "purchasing.order.create"),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const outsider = await newUser();
    await expect(
      assertModulePermission(full.org, outsider, "purchasing.order.read"),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("the contracted module does not replace the role", async () => {
    const viewer = await addMember(full.org, ["viewer"]);
    await expect(
      assertModulePermission(full.org, viewer, "purchasing.order.create"),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      assertModulePermission(full.org, viewer, "purchasing.order.read"),
    ).resolves.toBeUndefined();
  });

  it("platform permissions need no module", async () => {
    const empty = await newCompany();
    await expect(
      assertModulePermission(empty.org, empty.owner, "platform.team.invite"),
    ).resolves.toBeUndefined();
    await expect(
      assertModulePermission(empty.org, empty.owner, "inventory.product.read"),
    ).rejects.toMatchObject({ code: "module_not_contracted" });
  });

  it("the module of one company does not serve another", async () => {
    await expect(
      assertModulePermission(basic.org, full.owner, "purchasing.order.read"),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      assertModulePermission(full.org, basic.owner, "purchasing.order.read"),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("a module whose validity ended is rejected at once", async () => {
    const company = await newCompany();
    await grant(company.org, "inventory", {
      until: new Date(Date.now() + 1500),
    });
    await expect(
      assertModulePermission(
        company.org,
        company.owner,
        "inventory.product.read",
      ),
    ).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    // No invalidation: the cached right simply stopped counting. What was
    // granted and ended stays readable, but nothing can be written.
    await expect(
      assertModulePermission(
        company.org,
        company.owner,
        "inventory.product.create",
      ),
    ).rejects.toMatchObject({ code: "module_read_only" });
  });

  it("contracting the module opens it after invalidating", async () => {
    const company = await newCompany();
    await grant(company.org, "inventory");
    await expect(
      assertModulePermission(
        company.org,
        company.owner,
        "purchasing.order.read",
      ),
    ).rejects.toMatchObject({ code: "module_not_contracted" });
    await grant(company.org, "purchasing");
    await expect(
      assertModulePermission(
        company.org,
        company.owner,
        "purchasing.order.read",
      ),
    ).resolves.toBeUndefined();
  });

  it("an unknown permission is denied", async () => {
    await expect(
      assertModulePermission(
        full.org,
        full.owner,
        "sales.ticket.create" as never,
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
});

describe("entitles", () => {
  it("answers for a whole set of entitlements", async () => {
    const entitlements = await getEntitlements(basic.org);
    expect(entitles(entitlements, "inventory.product.read")).toBe(true);
    expect(entitles(entitlements, "purchasing.order.read")).toBe(false);
    expect(entitles(entitlements, "platform.audit.read")).toBe(true);
  });
});

describe("assertWithinLimit", () => {
  it("allows up to the limit and rejects one more", async () => {
    const company = await newCompany();
    await grant(company.org, "active_products", { value: 100 });
    const entitlements = await getFreshEntitlements(company.org);
    expect(() =>
      assertWithinLimit(entitlements, "active_products", 99),
    ).not.toThrow();
    expect(() =>
      assertWithinLimit(entitlements, "active_products", 90, 10),
    ).not.toThrow();
    for (const [used, adding] of [
      [100, 1],
      [99, 2],
      [0, 101],
    ] as const) {
      expect(() =>
        assertWithinLimit(entitlements, "active_products", used, adding),
      ).toThrowError(
        expect.objectContaining({
          kind: "limit_reached",
          code: "limit_reached",
          details: expect.objectContaining({ limit: 100 }),
        }),
      );
    }
  });

  it("a limit that was never granted has no room", async () => {
    const company = await newCompany();
    const entitlements = await getFreshEntitlements(company.org);
    expect(() => assertWithinLimit(entitlements, "active_products", 0)).toThrow(
      /límite de tu plan/,
    );
    expect(() => assertWithinLimit(entitlements, "users", 0, 0)).toThrow();
  });

  it("rejects nonsense amounts", async () => {
    const company = await newCompany();
    await grant(company.org, "users", { value: 5 });
    const entitlements = await getFreshEntitlements(company.org);
    for (const [used, adding] of [
      [1, -1],
      [1.5, 1],
      [Number.NaN, 1],
    ]) {
      expect(() =>
        assertWithinLimit(entitlements, "users", used!, adding),
      ).toThrow();
    }
  });
});
