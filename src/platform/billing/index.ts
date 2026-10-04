// Public API of platform/billing: Plans, subscriptions and entitlements (MOD/BIL).
export {
  ModuleContractError,
  PLATFORM_FEATURES,
  defineModule,
  validateModuleContract,
} from "./contract";
export type { ModuleContract, ModuleLimit, PlatformFeature } from "./contract";
export { createModuleRegistry, validateModuleRegistry } from "./registry";
export type { ModuleRegistry } from "./registry";
export {
  ENTITLEMENT_CACHE_MS,
  getEntitlements,
  getFreshEntitlements,
  invalidateEntitlements,
  setEntitlementClock,
} from "./entitlements";
export type { Entitlements } from "./entitlements";
