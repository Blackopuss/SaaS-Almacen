// Public API of platform/billing: Plans, subscriptions and entitlements (MOD/BIL).
export {
  ModuleContractError,
  PLATFORM_FEATURES,
  defineModule,
  validateModuleContract,
} from "./contract";
export type { ModuleContract, ModuleLimit, PlatformFeature } from "./contract";
