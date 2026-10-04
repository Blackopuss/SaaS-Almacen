import { describe, expect, it } from "vitest";

import {
  OWNER_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  type Permission,
  type Role,
} from "./catalog";
import { can, canAll, canAny, knownRoles, permissionsOf } from "./policy";

// USR-02: one decision function, tested for every role and every action,
// denying by default.

const member = (...roles: string[]) => ({ isOwner: false, roles });
const owner = (...roles: string[]) => ({ isOwner: true, roles });

describe("can: every role against every permission", () => {
  for (const role of ROLES) {
    it(`${role} gets exactly its list`, () => {
      const allowed = new Set<string>(ROLE_PERMISSIONS[role]);
      for (const permission of PERMISSIONS) {
        expect(can(member(role), permission), permission).toBe(
          allowed.has(permission),
        );
      }
    });
  }

  it("titular gets exactly the titular list", () => {
    const allowed = new Set<string>(OWNER_PERMISSIONS);
    for (const permission of PERMISSIONS) {
      expect(can(owner(), permission), permission).toBe(
        allowed.has(permission),
      );
    }
  });
});

describe("deny by default", () => {
  it("a member without roles can do nothing", () => {
    expect(permissionsOf(member()).size).toBe(0);
    for (const permission of PERMISSIONS) {
      expect(can(member(), permission)).toBe(false);
    }
  });

  it.each(["owner", "titular", "Administrador", "ADMINISTRATOR", "admin", ""])(
    "unknown role %j grants nothing",
    (role) => {
      expect(permissionsOf(member(role)).size).toBe(0);
    },
  );

  it.each([
    "inventory.product.delete",
    "inventory.*",
    "*",
    "",
    "INVENTORY.PRODUCT.READ",
    "toString",
    "__proto__",
  ])("unknown permission %j is denied even to the titular", (permission) => {
    expect(can(owner("administrator"), permission as Permission)).toBe(false);
    expect(canAny(owner(), [permission as Permission])).toBe(false);
    expect(canAll(owner(), [permission as Permission])).toBe(false);
  });

  it.each([undefined, null, 1, {}, []])(
    "non-text permission %j is denied",
    (permission) => {
      expect(can(owner(), permission as unknown as Permission)).toBe(false);
    },
  );

  it("a truthy value that is not `true` does not make a titular", () => {
    const fake = { isOwner: "yes" as unknown as boolean, roles: [] };
    expect(permissionsOf(fake).size).toBe(0);
  });

  it("nobody in a company can provision the platform", () => {
    for (const role of ROLES) {
      expect(can(owner(role), "platform.provisioning.manage")).toBe(false);
    }
  });

  it("an empty list is never satisfied", () => {
    expect(canAll(owner(), [])).toBe(false);
    expect(canAny(owner(), [])).toBe(false);
  });
});

describe("combined roles", () => {
  it("join their permissions and add nothing else", () => {
    for (const a of ROLES) {
      for (const b of ROLES) {
        const expected = new Set<string>([
          ...ROLE_PERMISSIONS[a],
          ...ROLE_PERMISSIONS[b],
        ]);
        expect(new Set<string>(permissionsOf(member(a, b)))).toEqual(expected);
      }
    }
  });

  it("warehouse + buyer moves stock and buys, but does not manage the team", () => {
    const subject = member("warehouse", "buyer");
    expect(can(subject, "inventory.adjustment.create")).toBe(true);
    expect(can(subject, "purchasing.order.create")).toBe(true);
    expect(can(subject, "platform.team.invite")).toBe(false);
  });

  it("repeated and unknown roles are ignored", () => {
    expect(knownRoles(["viewer", "viewer", "cajero", "buyer"])).toEqual<Role[]>(
      ["buyer", "viewer"],
    );
  });

  it("roles never take anything away from the titular", () => {
    expect(new Set<string>(permissionsOf(owner("viewer")))).toEqual(
      new Set<string>(OWNER_PERMISSIONS),
    );
  });
});

describe("rules of the approved matrix", () => {
  it("viewer never writes", () => {
    for (const permission of permissionsOf(member("viewer"))) {
      expect(permission).toMatch(/\.(read|export|create)$/);
    }
    expect(can(member("viewer"), "inventory.entry.create")).toBe(false);
    expect(can(member("viewer"), "purchasing.cost.read")).toBe(false);
  });

  it("warehouse does not buy, receive or return", () => {
    for (const permission of PERMISSIONS) {
      if (permission.startsWith("purchasing.")) {
        expect(can(member("warehouse"), permission), permission).toBe(false);
      }
    }
  });

  it("administrator does not charge, contract or transfer", () => {
    for (const permission of [
      "platform.billing.read",
      "platform.billing.manage",
      "platform.subscription.create",
      "platform.subscription.cancel",
      "platform.plan.change",
      "platform.module.activate",
      "platform.module.deactivate",
      "platform.ownership.transfer",
    ] as const) {
      expect(can(member("administrator"), permission), permission).toBe(false);
      expect(can(owner(), permission), permission).toBe(true);
    }
  });

  it("canAll and canAny", () => {
    const buyer = member("buyer");
    expect(
      canAll(buyer, ["purchasing.order.create", "inventory.stock.read"]),
    ).toBe(true);
    expect(
      canAll(buyer, ["purchasing.order.create", "inventory.entry.create"]),
    ).toBe(false);
    expect(
      canAny(buyer, ["inventory.entry.create", "purchasing.order.create"]),
    ).toBe(true);
    expect(canAny(buyer, ["inventory.entry.create"])).toBe(false);
  });
});
