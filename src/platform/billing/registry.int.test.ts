import { describe, expect, it } from "vitest";

import { ModuleContractError, type ModuleContract } from "./contract";
import { createModuleRegistry, validateModuleRegistry } from "./registry";

// MOD-02: the registry starts only with a consistent set of contracts;
// invalid or circular dependencies are detected.

const contract = (
  id: string,
  change: Partial<ModuleContract> = {},
): ModuleContract => ({
  id,
  name: id,
  version: "1.0.0",
  availability: "unavailable",
  required: false,
  dependsOn: [],
  uses: [],
  permissions: [],
  limits: [],
  ...change,
});

const inventory = contract("inventory", {
  availability: "available",
  required: true,
  permissions: ["inventory.product.read"],
});
const purchasing = contract("purchasing", {
  availability: "available",
  dependsOn: ["inventory"],
  permissions: ["purchasing.order.read"],
});
const sales = contract("sales", { dependsOn: ["inventory"] });
const crm = contract("crm");

describe("createModuleRegistry", () => {
  const registry = createModuleRegistry([purchasing, crm, sales, inventory]);

  it("starts and orders dependencies before dependents", () => {
    const ids = registry.all.map((m) => m.id);
    expect(ids.indexOf("inventory")).toBeLessThan(ids.indexOf("purchasing"));
    expect(ids.indexOf("inventory")).toBeLessThan(ids.indexOf("sales"));
    expect([...ids].sort()).toEqual([
      "crm",
      "inventory",
      "purchasing",
      "sales",
    ]);
  });

  it("knows the base and what can be contracted today", () => {
    expect(registry.base.id).toBe("inventory");
    expect(registry.available.map((m) => m.id)).toEqual([
      "inventory",
      "purchasing",
    ]);
    expect(registry.has("sales")).toBe(true);
    expect(registry.has("payroll")).toBe(false);
    expect(() => registry.get("payroll")).toThrow(/Unknown module/);
  });

  it("answers dependencies and dependents, also indirect ones", () => {
    const chain = createModuleRegistry([
      inventory,
      contract("sales", { dependsOn: ["inventory"] }),
      contract("invoicing", { dependsOn: ["sales"] }),
    ]);
    expect(chain.dependenciesOf("invoicing").map((m) => m.id)).toEqual([
      "inventory",
      "sales",
    ]);
    expect(chain.dependentsOf("inventory").map((m) => m.id)).toEqual([
      "sales",
      "invoicing",
    ]);
    expect(chain.dependenciesOf("inventory")).toEqual([]);
    expect(chain.dependentsOf("invoicing")).toEqual([]);
  });

  it("finds the module that owns a permission", () => {
    expect(registry.moduleOfPermission("purchasing.order.read")?.id).toBe(
      "purchasing",
    );
    expect(registry.moduleOfPermission("platform.team.invite")).toBeNull();
    expect(registry.moduleOfPermission("sales.ticket.create")).toBeNull();
  });
});

describe("a registry that must not start", () => {
  const problems = (contracts: ModuleContract[]) =>
    validateModuleRegistry(contracts).join("\n");

  it("a dependency that is not registered", () => {
    expect(
      problems([inventory, contract("crm", { dependsOn: ["sales"] })]),
    ).toMatch(/crm: depends on "sales", which is not registered/);
    expect(() =>
      createModuleRegistry([
        inventory,
        contract("crm", { dependsOn: ["sales"] }),
      ]),
    ).toThrow(ModuleContractError);
  });

  it("a circular dependency, direct or through several modules", () => {
    expect(
      problems([
        inventory,
        contract("sales", { dependsOn: ["crm"] }),
        contract("crm", { dependsOn: ["sales"] }),
      ]),
    ).toMatch(/circular dependency (sales → crm → sales|crm → sales → crm)/);
    expect(
      problems([
        inventory,
        contract("aa", { dependsOn: ["bb"] }),
        contract("bb", { dependsOn: ["cc"] }),
        contract("cc", { dependsOn: ["aa"] }),
      ]),
    ).toMatch(/circular dependency aa → bb → cc → aa/);
  });

  it("an available module that depends on an unavailable one", () => {
    expect(
      problems([
        inventory,
        sales,
        contract("purchasing", {
          availability: "available",
          dependsOn: ["sales"],
          permissions: ["purchasing.order.read"],
        }),
      ]),
    ).toMatch(/purchasing: is available but depends on "sales", which is not/);
  });

  it("the same module twice, no base or two bases", () => {
    expect(problems([inventory, inventory])).toMatch(
      /registered more than once/,
    );
    expect(problems([purchasing])).toMatch(/exactly one required base/);
    expect(
      problems([
        inventory,
        contract("warehouses", {
          availability: "available",
          required: true,
          permissions: [],
        }),
      ]),
    ).toMatch(/exactly one required base is needed, found 2/);
  });

  it("an invalid contract inside the set", () => {
    expect(problems([inventory, contract("crm", { version: "2" })])).toMatch(
      /crm: version "2" is not semver/,
    );
  });
});
