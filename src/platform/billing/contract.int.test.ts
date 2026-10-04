import { describe, expect, it } from "vitest";

import type { Permission } from "@/platform/authorization";

import {
  ModuleContractError,
  defineModule,
  validateModuleContract,
  type ModuleContract,
} from "./contract";

// MOD-01: a module is described by one contract; an invalid one is refused
// with every problem listed.

const valid: ModuleContract = {
  id: "purchasing",
  name: "Compras",
  version: "1.0.0",
  availability: "available",
  required: false,
  dependsOn: ["inventory"],
  uses: ["contacts", "catalog"],
  permissions: ["purchasing.order.read", "purchasing.order.create"],
  limits: [],
};

const base: ModuleContract = {
  id: "inventory",
  name: "Inventario",
  version: "1.2.3",
  availability: "available",
  required: true,
  dependsOn: [],
  uses: ["catalog"],
  permissions: ["inventory.product.read"],
  limits: [{ key: "active_products", label: "Productos activos" }],
};

const problemsOf = (change: Partial<Record<keyof ModuleContract, unknown>>) =>
  validateModuleContract({ ...valid, ...change } as ModuleContract);

describe("validateModuleContract", () => {
  it("accepts a complete contract", () => {
    expect(validateModuleContract(valid)).toEqual([]);
    expect(validateModuleContract(base)).toEqual([]);
  });

  it.each(["", "Compras", "purchasing-2", "9lives", "a", "compras módulo"])(
    "rejects id %j",
    (id) => {
      expect(problemsOf({ id, permissions: [] }).join()).toMatch(/id must be/);
    },
  );

  it.each(["1", "1.0", "v1.0.0", "1.0.0-beta", "01.0.0", ""])(
    "rejects version %j",
    (version) => {
      expect(problemsOf({ version }).join()).toMatch(/not semver/);
    },
  );

  it("rejects a missing name and an unknown availability", () => {
    expect(problemsOf({ name: " " }).join()).toMatch(/name is required/);
    expect(problemsOf({ availability: "beta" }).join()).toMatch(
      /availability "beta"/,
    );
    expect(problemsOf({ required: "yes" }).join()).toMatch(/must be boolean/);
  });

  it("rejects depending on itself, repeated or malformed dependencies", () => {
    expect(problemsOf({ dependsOn: ["purchasing"] }).join()).toMatch(
      /cannot depend on itself/,
    );
    expect(
      problemsOf({ dependsOn: ["inventory", "inventory"] }).join(),
    ).toMatch(/"inventory" is repeated/);
    expect(problemsOf({ dependsOn: ["Inventario"] }).join()).toMatch(
      /not a module id/,
    );
    expect(problemsOf({ dependsOn: "inventory" }).join()).toMatch(
      /dependsOn must be a list/,
    );
  });

  it("the required base has no dependencies and is available", () => {
    expect(
      validateModuleContract({ ...base, dependsOn: ["purchasing"] }).join(),
    ).toMatch(/cannot depend on other modules/);
    expect(
      validateModuleContract({ ...base, availability: "unavailable" }).join(),
    ).toMatch(/must be available/);
  });

  it("permissions must exist in the catalog and belong to the module", () => {
    expect(
      problemsOf({ permissions: ["purchasing.order.delete"] }).join(),
    ).toMatch(/not in the catalog/);
    expect(
      problemsOf({
        permissions: ["purchasing.order.read", "inventory.product.read"],
      }).join(),
    ).toMatch(/"inventory.product.read" does not belong/);
    expect(
      problemsOf({
        permissions: ["purchasing.order.read", "platform.team.invite"],
      }).join(),
    ).toMatch(/does not belong/);
    expect(
      problemsOf({
        permissions: ["purchasing.order.read", "purchasing.order.read"],
      }).join(),
    ).toMatch(/is repeated/);
  });

  it("an available module owns permissions; an unavailable one may not yet", () => {
    expect(problemsOf({ permissions: [] }).join()).toMatch(
      /at least one permission/,
    );
    expect(
      validateModuleContract({
        ...valid,
        id: "sales",
        availability: "unavailable",
        permissions: [],
      }),
    ).toEqual([]);
  });

  it("rejects unknown platform features and bad limits", () => {
    expect(problemsOf({ uses: ["billing"] }).join()).toMatch(
      /not a platform feature/,
    );
    expect(
      problemsOf({ limits: [{ key: "Productos", label: "Productos" }] }).join(),
    ).toMatch(/limit key "Productos"/);
    expect(
      problemsOf({ limits: [{ key: "active_products", label: "" }] }).join(),
    ).toMatch(/needs a label/);
    expect(
      problemsOf({
        limits: [
          { key: "users", label: "Usuarios" },
          { key: "users", label: "Personas" },
        ],
      }).join(),
    ).toMatch(/limit "users" is repeated/);
  });

  it("lists every problem at once, naming the module", () => {
    const problems = problemsOf({
      version: "x",
      dependsOn: ["purchasing"],
      permissions: ["inventory.product.read" as Permission],
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(problems.every((p) => p.startsWith("purchasing: "))).toBe(true);
  });
});

describe("defineModule", () => {
  it("returns the contract, frozen", () => {
    const contract = defineModule(valid);
    expect(contract).toEqual(valid);
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.permissions)).toBe(true);
    expect(() => {
      (contract.permissions as Permission[]).push("purchasing.order.send");
    }).toThrow();
  });

  it("throws with every problem when the contract is invalid", () => {
    expect(() => defineModule({ ...valid, version: "1", name: "" })).toThrow(
      ModuleContractError,
    );
    try {
      defineModule({ ...valid, version: "1", name: "" });
    } catch (error) {
      expect((error as ModuleContractError).problems).toHaveLength(2);
    }
  });
});
