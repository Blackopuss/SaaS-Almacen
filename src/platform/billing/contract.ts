/**
 * Module contract (MOD-01). Every contractable module declares, in one
 * object, what it is and what it needs: identifier, version, the modules
 * it depends on, the permissions it owns and the limits it counts against.
 * Entitlements, the server guard and the plan screens are built from these
 * contracts, so nothing about a module is decided in two places.
 *
 * Pure: no database. Contracts are code written by us; there are no
 * modules uploaded by customers.
 */
import { isPermission, type Permission } from "@/platform/authorization";

/** Parts of the shared core a module may rely on (never contracted alone). */
export const PLATFORM_FEATURES = ["catalog", "contacts"] as const;
export type PlatformFeature = (typeof PLATFORM_FEATURES)[number];

export type ModuleLimit = {
  /** Stable key used by entitlements, e.g. "active_products". */
  key: string;
  /** Name shown to people, in Spanish. */
  label: string;
};

export type ModuleContract = {
  /** Stable identifier, also the prefix of its permissions: "inventory". */
  id: string;
  /** Name shown to people, in Spanish. */
  name: string;
  /** Contract version (semver). Changes when permissions or limits change. */
  version: string;
  /** "unavailable" = announced but not sold yet: it can never be activated. */
  availability: "available" | "unavailable";
  /** The base every company has; it cannot be removed. */
  required: boolean;
  /** Ids of the modules that must be active for this one to work. */
  dependsOn: readonly string[];
  /** Parts of the shared core it uses. */
  uses: readonly PlatformFeature[];
  /** Permissions it owns; all start with `${id}.` and exist in the catalog. */
  permissions: readonly Permission[];
  /** Commercial limits it counts against. */
  limits: readonly ModuleLimit[];
};

const ID = /^[a-z][a-z_]{1,30}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LIMIT_KEY = /^[a-z][a-z_]{1,40}$/;

function repeated(values: readonly string[]): string[] {
  return [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
}

/** Every problem of a contract, as text for developers; empty when valid. */
export function validateModuleContract(contract: ModuleContract): string[] {
  const problems: string[] = [];
  const id = typeof contract.id === "string" ? contract.id : "";
  const say = (text: string) => problems.push(`${id || "(sin id)"}: ${text}`);

  if (!ID.test(id)) say("id must be lower case letters and underscores");
  if (typeof contract.name !== "string" || contract.name.trim().length < 2) {
    say("name is required");
  }
  if (!SEMVER.test(String(contract.version))) {
    say(`version "${contract.version}" is not semver (1.0.0)`);
  }
  if (!["available", "unavailable"].includes(contract.availability)) {
    say(`availability "${String(contract.availability)}" is not valid`);
  }
  if (typeof contract.required !== "boolean") say("required must be boolean");

  const dependsOn = Array.isArray(contract.dependsOn) ? contract.dependsOn : [];
  if (!Array.isArray(contract.dependsOn)) say("dependsOn must be a list");
  for (const dependency of dependsOn) {
    if (!ID.test(String(dependency))) {
      say(`dependency "${String(dependency)}" is not a module id`);
    }
  }
  if (dependsOn.includes(id)) say("a module cannot depend on itself");
  for (const dependency of repeated(dependsOn)) {
    say(`dependency "${dependency}" is repeated`);
  }
  if (contract.required === true && dependsOn.length > 0) {
    say("the required base cannot depend on other modules");
  }
  if (contract.required === true && contract.availability !== "available") {
    say("the required base must be available");
  }

  const uses = Array.isArray(contract.uses) ? contract.uses : [];
  if (!Array.isArray(contract.uses)) say("uses must be a list");
  for (const feature of uses) {
    if (!(PLATFORM_FEATURES as readonly string[]).includes(feature)) {
      say(`"${String(feature)}" is not a platform feature`);
    }
  }
  for (const feature of repeated(uses)) say(`feature "${feature}" is repeated`);

  const permissions = Array.isArray(contract.permissions)
    ? contract.permissions
    : [];
  if (!Array.isArray(contract.permissions)) say("permissions must be a list");
  if (permissions.length === 0 && contract.availability === "available") {
    say("an available module must own at least one permission");
  }
  for (const permission of permissions) {
    if (!isPermission(permission)) {
      say(`permission "${String(permission)}" is not in the catalog`);
    } else if (!permission.startsWith(`${id}.`)) {
      say(`permission "${permission}" does not belong to this module`);
    }
  }
  for (const permission of repeated(permissions)) {
    say(`permission "${permission}" is repeated`);
  }

  const limits = Array.isArray(contract.limits) ? contract.limits : [];
  if (!Array.isArray(contract.limits)) say("limits must be a list");
  for (const limit of limits) {
    if (!LIMIT_KEY.test(String(limit?.key))) {
      say(`limit key "${String(limit?.key)}" is not valid`);
    }
    if (typeof limit?.label !== "string" || limit.label.trim().length < 2) {
      say(`limit "${String(limit?.key)}" needs a label`);
    }
  }
  for (const key of repeated(limits.map((limit) => String(limit?.key)))) {
    say(`limit "${key}" is repeated`);
  }

  return problems;
}

export class ModuleContractError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid module contract:\n- ${problems.join("\n- ")}`);
    this.name = "ModuleContractError";
  }
}

/** Declares a module: returns the contract frozen, or throws listing every problem. */
export function defineModule<const T extends ModuleContract>(contract: T): T {
  const problems = validateModuleContract(contract);
  if (problems.length > 0) throw new ModuleContractError(problems);
  return Object.freeze({
    ...contract,
    dependsOn: Object.freeze([...contract.dependsOn]),
    uses: Object.freeze([...contract.uses]),
    permissions: Object.freeze([...contract.permissions]),
    limits: Object.freeze(contract.limits.map((l) => Object.freeze({ ...l }))),
  }) as T;
}
