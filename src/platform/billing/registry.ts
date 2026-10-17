/**
 * Module registry (MOD-02): the set of module contracts of the product,
 * checked as a whole when the application starts. A registry with an
 * unknown or circular dependency, two bases or a permission owned twice
 * does not start.
 *
 * Pure: it receives the contracts; the list of installed modules lives in
 * src/modules/registry (the platform never imports business modules).
 */
import { ModuleContractError, validateModuleContract } from "./contract";
import type { ModuleContract } from "./contract";

export type ModuleRegistry = {
  /** Every contract, dependencies before dependents. */
  all: readonly ModuleContract[];
  /** Modules that can be contracted today. */
  available: readonly ModuleContract[];
  /** The base every company has. */
  base: ModuleContract;
  has(id: string): boolean;
  get(id: string): ModuleContract;
  /** Everything `id` needs, direct or not, dependencies first. */
  dependenciesOf(id: string): readonly ModuleContract[];
  /** Everything that needs `id`, direct or not. */
  dependentsOf(id: string): readonly ModuleContract[];
  /** Module that owns a permission; null for platform permissions. */
  moduleOfPermission(permission: string): ModuleContract | null;
};

/** Finds a dependency cycle and returns it as "a → b → a", or null. */
function findCycle(byId: Map<string, ModuleContract>): string | null {
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string | null => {
    const at = path.indexOf(id);
    if (at !== -1) return [...path.slice(at), id].join(" → ");
    if (done.has(id)) return null;
    path.push(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    done.add(id);
    return null;
  };
  for (const id of byId.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/** Problems of a set of contracts taken together; empty when it can start. */
export function validateModuleRegistry(
  contracts: readonly ModuleContract[],
): string[] {
  const problems = contracts.flatMap(validateModuleContract);
  const byId = new Map<string, ModuleContract>();
  for (const contract of contracts) {
    if (byId.has(contract.id)) {
      problems.push(`${contract.id}: registered more than once`);
    }
    byId.set(contract.id, contract);
  }

  const bases = contracts.filter((c) => c.required === true);
  if (bases.length !== 1) {
    problems.push(
      `registry: exactly one required base is needed, found ${bases.length}`,
    );
  }

  for (const contract of contracts) {
    for (const dependency of contract.dependsOn ?? []) {
      const target = byId.get(dependency);
      if (!target) {
        problems.push(
          `${contract.id}: depends on "${dependency}", which is not registered`,
        );
      } else if (
        contract.availability === "available" &&
        target.availability !== "available"
      ) {
        problems.push(
          `${contract.id}: is available but depends on "${dependency}", which is not`,
        );
      }
    }
  }

  const cycle = findCycle(byId);
  if (cycle) problems.push(`registry: circular dependency ${cycle}`);

  const owners = new Map<string, string>();
  for (const contract of contracts) {
    for (const permission of contract.permissions ?? []) {
      const owner = owners.get(permission);
      if (owner && owner !== contract.id) {
        problems.push(
          `${contract.id}: permission "${permission}" already belongs to "${owner}"`,
        );
      }
      owners.set(permission, contract.id);
    }
  }
  return problems;
}

/** Builds the registry or throws listing every problem. */
export function createModuleRegistry(
  contracts: readonly ModuleContract[],
): ModuleRegistry {
  const problems = validateModuleRegistry(contracts);
  if (problems.length > 0) throw new ModuleContractError(problems);

  const byId = new Map(contracts.map((c) => [c.id, c]));
  const get = (id: string) => {
    const contract = byId.get(id);
    if (!contract) throw new Error(`Unknown module "${id}"`);
    return contract;
  };

  // Dependencies first (the graph has no cycles).
  const ordered: ModuleContract[] = [];
  const place = (contract: ModuleContract) => {
    if (ordered.includes(contract)) return;
    for (const dependency of contract.dependsOn) place(get(dependency));
    ordered.push(contract);
  };
  contracts.forEach(place);

  const dependenciesOf = (id: string) => {
    const found = new Set<ModuleContract>();
    const walk = (contract: ModuleContract) => {
      for (const dependency of contract.dependsOn) {
        const target = get(dependency);
        if (!found.has(target)) {
          found.add(target);
          walk(target);
        }
      }
    };
    walk(get(id));
    return ordered.filter((contract) => found.has(contract));
  };

  const owners = new Map<string, ModuleContract>();
  for (const contract of contracts) {
    for (const permission of contract.permissions) {
      owners.set(permission, contract);
    }
  }

  return Object.freeze({
    all: Object.freeze(ordered),
    available: Object.freeze(
      ordered.filter((c) => c.availability === "available"),
    ),
    base: contracts.find((c) => c.required)!,
    has: (id: string) => byId.has(id),
    get,
    dependenciesOf,
    dependentsOf: (id: string) => {
      get(id);
      return ordered.filter((contract) =>
        dependenciesOf(contract.id).some((d) => d.id === id),
      );
    },
    moduleOfPermission: (permission: string) => owners.get(permission) ?? null,
  });
}
