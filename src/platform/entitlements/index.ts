// Public API of platform/entitlements: what a company may use right now
// (modules and limits, MOD-04) and how much of each limit it is using
// (MOD-07). Depends only on the database, so every other area can ask.
export {
  ENTITLEMENT_CACHE_MS,
  getEntitlements,
  getFreshEntitlements,
  invalidateEntitlements,
  readLimit,
  setEntitlementClock,
} from "./entitlements";
export type { Entitlements, LimitReader } from "./entitlements";
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
