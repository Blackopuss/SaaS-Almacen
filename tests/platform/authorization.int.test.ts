import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  assertAllowed,
  assertOwnerAction,
  isAllowed,
  loadSubject,
  type Role,
} from "@/platform/authorization";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// USR-02: the decision is taken from the database (active membership, its
// roles and the company's titular), per company, denying by default.

const stamp = Date.now();

async function newUser(label: string) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `${label}.authz.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function newCompany(ownerId: string, name: string) {
  const result = await createOrganization(ownerId, { name, timeZone: "" });
  if (!result.ok) throw new Error("company setup failed");
  return result.organizationId;
}

async function addMember(
  organizationId: string,
  userId: string,
  roles: Role[],
  status: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId, status },
  });
  for (const role of roles) {
    await db.membershipRole.create({
      data: {
        id: newId(),
        organizationId,
        membershipId: membership.id,
        role,
      },
    });
  }
}

let esperanza = "";
let tornillo = "";
let ana = "";
let beto = "";

beforeAll(async () => {
  ana = await newUser("ana");
  beto = await newUser("beto");
  esperanza = await newCompany(ana, "Ferretería La Esperanza");
  tornillo = await newCompany(beto, "Ferretería El Tornillo");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("isAllowed", () => {
  it("the titular can contract; only in their own company", async () => {
    expect(
      await isAllowed(esperanza, ana, "platform.subscription.create"),
    ).toBe(true);
    expect(await isAllowed(tornillo, ana, "platform.subscription.create")).toBe(
      false,
    );
    expect(await isAllowed(tornillo, ana, "inventory.product.read")).toBe(
      false,
    );
  });

  it("each role does what the matrix says", async () => {
    const cases: [Role, boolean, boolean, boolean][] = [
      // role, adjusts stock, creates order, invites
      ["administrator", true, true, true],
      ["warehouse", true, false, false],
      ["buyer", false, true, false],
      ["viewer", false, false, false],
    ];
    for (const [role, adjusts, buys, invites] of cases) {
      const userId = await newUser(`rol-${role}`);
      await addMember(esperanza, userId, [role]);
      expect(
        await isAllowed(esperanza, userId, "inventory.adjustment.create"),
        role,
      ).toBe(adjusts);
      expect(
        await isAllowed(esperanza, userId, "purchasing.order.create"),
        role,
      ).toBe(buys);
      expect(
        await isAllowed(esperanza, userId, "platform.team.invite"),
        role,
      ).toBe(invites);
      expect(
        await isAllowed(esperanza, userId, "platform.billing.manage"),
        role,
      ).toBe(false);
      expect(
        await isAllowed(esperanza, userId, "inventory.product.read"),
        role,
      ).toBe(true);
    }
  });

  it("a member without roles can do nothing", async () => {
    const userId = await newUser("sin-rol");
    await addMember(esperanza, userId, []);
    expect(await loadSubject(esperanza, userId)).toEqual({
      isOwner: false,
      roles: [],
    });
    expect(await isAllowed(esperanza, userId, "inventory.product.read")).toBe(
      false,
    );
  });

  it("a disabled member loses everything, whatever their roles", async () => {
    const userId = await newUser("baja");
    await addMember(esperanza, userId, ["administrator"], "DISABLED");
    expect(await isAllowed(esperanza, userId, "inventory.product.read")).toBe(
      false,
    );
  });

  it("someone outside the company can do nothing", async () => {
    const userId = await newUser("ajeno");
    expect(await isAllowed(esperanza, userId, "inventory.product.read")).toBe(
      false,
    );
    expect(await isAllowed(newId(), userId, "inventory.product.read")).toBe(
      false,
    );
  });

  it("roles are per company", async () => {
    const userId = await newUser("dos-empresas");
    await addMember(esperanza, userId, ["administrator"]);
    await addMember(tornillo, userId, ["viewer"]);
    expect(await isAllowed(esperanza, userId, "platform.team.invite")).toBe(
      true,
    );
    expect(await isAllowed(tornillo, userId, "platform.team.invite")).toBe(
      false,
    );
    expect(await isAllowed(tornillo, userId, "inventory.stock.read")).toBe(
      true,
    );
  });

  it("combined roles join their permissions", async () => {
    const userId = await newUser("combinado");
    await addMember(esperanza, userId, ["warehouse", "buyer"]);
    expect(
      await isAllowed(esperanza, userId, "inventory.adjustment.create"),
    ).toBe(true);
    expect(await isAllowed(esperanza, userId, "purchasing.order.create")).toBe(
      true,
    );
    expect(await isAllowed(esperanza, userId, "platform.audit.read")).toBe(
      false,
    );
  });

  it("a titular whose membership is disabled is denied", async () => {
    const owner = await newUser("titular-baja");
    const company = await newCompany(owner, "Ferretería Cerrada");
    await db.membership.updateMany({
      where: { organizationId: company, userId: owner },
      data: { status: "DISABLED" },
    });
    expect(await isAllowed(company, owner, "platform.organization.read")).toBe(
      false,
    );
  });
});

describe("assertAllowed", () => {
  it("passes when allowed", async () => {
    await expect(
      assertAllowed(esperanza, ana, "platform.ownership.transfer"),
    ).resolves.toBeUndefined();
  });

  it("throws a forbidden error in Spanish when denied", async () => {
    await expect(
      assertAllowed(esperanza, beto, "inventory.product.read"),
    ).rejects.toMatchObject({
      kind: "forbidden",
      code: "permission_denied",
      message: "No tienes permiso para hacer esto.",
    });
  });
});

// USR-03A: contracting, cancelling and the payment method belong to the
// titular alone, checked against the database.
describe("assertOwnerAction", () => {
  const RESERVED = [
    "platform.subscription.create",
    "platform.subscription.cancel",
    "platform.billing.manage",
  ] as const;

  it("lets the titular contract, cancel and change the payment method", async () => {
    for (const permission of RESERVED) {
      await expect(
        assertOwnerAction(esperanza, ana, permission),
      ).resolves.toBeUndefined();
    }
  });

  it("rejects an administrator with every role", async () => {
    const userId = await newUser("admin-total");
    await addMember(esperanza, userId, [
      "administrator",
      "warehouse",
      "buyer",
      "viewer",
    ]);
    for (const permission of RESERVED) {
      await expect(
        assertOwnerAction(esperanza, userId, permission),
      ).rejects.toMatchObject({
        kind: "forbidden",
        code: "owner_only",
        message: "Solo el titular de la empresa puede hacer esto.",
      });
    }
  });

  it("rejects the titular of another company and outsiders", async () => {
    for (const permission of RESERVED) {
      await expect(
        assertOwnerAction(esperanza, beto, permission),
      ).rejects.toMatchObject({ code: "owner_only" });
      await expect(
        assertOwnerAction(newId(), ana, permission),
      ).rejects.toMatchObject({ code: "owner_only" });
    }
  });

  it("rejects a titular whose membership is disabled", async () => {
    const owner = await newUser("titular-sin-acceso");
    const company = await newCompany(owner, "Ferretería En Pausa");
    await db.membership.updateMany({
      where: { organizationId: company, userId: owner },
      data: { status: "DISABLED" },
    });
    await expect(
      assertOwnerAction(company, owner, "platform.subscription.cancel"),
    ).rejects.toMatchObject({ code: "owner_only" });
  });

  it("refuses to guard an action that a role could do", async () => {
    await expect(
      assertOwnerAction(esperanza, ana, "platform.team.invite"),
    ).rejects.toThrow(/not reserved/);
  });
});
