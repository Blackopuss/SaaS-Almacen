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
export {
  LIMIT_REACHED_MESSAGE,
  MODULE_NOT_CONTRACTED_MESSAGE,
  assertModulePermission,
  assertWithinLimit,
  entitles,
  getModuleAccess,
  moduleOfPermission,
  requireModulePermission,
} from "./guard";
export type { ModuleAccess } from "./guard";
export { activateModule, deactivateModule } from "./modules";
export type {
  ModuleChangeInput,
  ModuleChangeReason,
  ModuleChangeResult,
} from "./modules";
export {
  QUOTA_KEYS,
  confirmReservation,
  consumeQuota,
  getQuotaUsage,
  releaseQuota,
  releaseReservation,
  reserveQuota,
} from "./quota";
export type {
  QuotaClient,
  QuotaKey,
  QuotaResult,
  QuotaUsageSummary,
} from "./quota";
