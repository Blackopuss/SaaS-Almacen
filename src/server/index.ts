// Infrastructure: database client and transactions.
export { db } from "./db";
export {
  LOCKING_TRANSACTION,
  TENANT_MODELS,
  TenantScopeError,
  forOrganization,
  lockRows,
} from "./tenant-db";
export type { TenantDb } from "./tenant-db";
export type TransactionClient =
  import("./generated/prisma/client").Prisma.TransactionClient;
