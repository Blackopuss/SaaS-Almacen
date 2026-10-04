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
  LIMIT_REACHED_MESSAGE,
  MODULE_NOT_CONTRACTED_MESSAGE,
  MODULE_READ_ONLY_MESSAGE,
  assertModulePermission,
  assertWithinLimit,
  entitles,
  getModuleAccess,
  isReadOrExport,
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
  PROPOSED_TIERS,
  getCompanyPlan,
  isPlatformStaff,
  listCompaniesForStaff,
  provisionCompany,
  requirePlatformStaff,
} from "./provisioning";
export type {
  CompanyPlan,
  CompanySummary,
  ProvisionField,
  ProvisionInput,
  ProvisionResult,
} from "./provisioning";
export { getPlanOverview, usageLevel, usagePercent } from "./overview";
export type { PlanModule, PlanOverview } from "./overview";
