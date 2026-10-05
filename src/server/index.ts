// Infrastructure: database client and transactions.
export { db } from "./db";
export { TENANT_MODELS, TenantScopeError, forOrganization } from "./tenant-db";
export type { TenantDb } from "./tenant-db";
export type TransactionClient =
  import("./generated/prisma/client").Prisma.TransactionClient;
