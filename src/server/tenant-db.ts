import "server-only";

import { db } from "./db";

/**
 * Company-scoped data access (PLT-12). Business code never uses `db` for
 * company data: it asks for `forOrganization(organizationId)` with the id
 * from the active-company context (platform/tenancy). The scoped client
 *
 * - adds `organizationId` to every read, update and delete filter, so rows
 *   of other companies are invisible even when their id is known;
 * - checks `organizationId` on every create (callers pass the context's
 *   id explicitly; the types require it) and refuses another company;
 * - refuses moving a row to another company;
 * - refuses models without `organizationId` and raw SQL.
 *
 * Without a company id there is no client at all. Nested writes through
 * relations are not rewritten: composite keys make the database reject
 * rows of another company (PLT-13).
 */

/**
 * Models that carry `organizationId`. tenant-db.test.ts fails when a model
 * in prisma/schema.prisma has the column but is missing here.
 */
export const TENANT_MODELS = [
  "AuditEvent",
  "Entitlement",
  "Facility",
  "Invitation",
  "Location",
  "Membership",
  "MembershipRole",
  "OwnershipTransfer",
  "PresentationVersion",
  "Product",
  "ProductBrand",
  "ProductCategory",
  "ProductPresentation",
  "QuotaUsage",
  "StockBalance",
  "StockMovement",
  "StockMovementLine",
  "Subscription",
  "SubscriptionItem",
] as const;

const tenantModels = new Set<string>(TENANT_MODELS);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

const FILTERED = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);
const WRITES_DATA = new Set([
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
const RAW =
  /^\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe|runCommandRaw)/;

type Row = Record<string, unknown>;

function scopeWhere(where: unknown, organizationId: string, model: string) {
  const current = (where ?? {}) as Row;
  if (
    "organizationId" in current &&
    current.organizationId !== organizationId
  ) {
    throw new TenantScopeError(
      `${model}: el filtro pide otra empresa distinta a la activa.`,
    );
  }
  return { ...current, organizationId };
}

function scopeCreate(data: unknown, organizationId: string, model: string) {
  const row = (data ?? {}) as Row;
  if ("organization" in row) {
    throw new TenantScopeError(
      `${model}: usa organizationId, no la relación organization.`,
    );
  }
  if ("organizationId" in row && row.organizationId !== organizationId) {
    throw new TenantScopeError(
      `${model}: no se pueden crear registros de otra empresa.`,
    );
  }
  return { ...row, organizationId };
}

function checkUpdate(data: unknown, organizationId: string, model: string) {
  const row = (data ?? {}) as Row;
  if ("organization" in row) {
    throw new TenantScopeError(`${model}: no se puede cambiar la empresa.`);
  }
  if ("organizationId" in row && row.organizationId !== organizationId) {
    throw new TenantScopeError(`${model}: no se puede cambiar la empresa.`);
  }
}

function scopedArgs(
  model: string,
  operation: string,
  args: Row,
  organizationId: string,
): Row {
  if (!tenantModels.has(model)) {
    throw new TenantScopeError(
      `${model} no es un dato de empresa; usa su servicio de plataforma.`,
    );
  }
  const next: Row = { ...args };
  if (FILTERED.has(operation)) {
    next.where = scopeWhere(args.where, organizationId, model);
  }
  if (WRITES_DATA.has(operation)) {
    checkUpdate(
      operation === "upsert" ? args.update : args.data,
      organizationId,
      model,
    );
  }
  if (operation === "upsert") {
    next.create = scopeCreate(args.create, organizationId, model);
  } else if (CREATES.has(operation)) {
    next.data = Array.isArray(args.data)
      ? args.data.map((row) => scopeCreate(row, organizationId, model))
      : scopeCreate(args.data, organizationId, model);
  } else if (!FILTERED.has(operation)) {
    throw new TenantScopeError(`${model}.${operation} no está permitido.`);
  }
  return next;
}

function extend(organizationId: string) {
  return db.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(
            scopedArgs(model, operation, (args ?? {}) as Row, organizationId),
          );
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof extend>;

/** Blocks raw SQL on a scoped client (and on its transaction clients). */
function guard<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (typeof property === "string" && RAW.test(property)) {
        throw new TenantScopeError(
          "SQL directo no está permitido en el cliente de empresa.",
        );
      }
      if (property === "$transaction") {
        const original = Reflect.get(target, property, receiver) as (
          ...args: unknown[]
        ) => unknown;
        return (input: unknown, options?: unknown) =>
          typeof input === "function"
            ? original.call(
                target,
                (tx: object) => (input as (tx: object) => unknown)(guard(tx)),
                options,
              )
            : original.call(target, input, options);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

/** Data access limited to one company. Throws without a company id. */
export function forOrganization(organizationId: string): TenantDb {
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    throw new TenantScopeError("Consulta de negocio sin contexto de empresa.");
  }
  return guard(extend(organizationId));
}
