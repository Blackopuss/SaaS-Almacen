import "server-only";

import { forOrganization } from "@/server";

/**
 * Effective entitlements (MOD-04): what a company may use right now —
 * which modules and which limits — read from the `entitlement` table.
 *
 * Rows are cached per company for a short time, because every guarded
 * request asks. The cache keeps the validity dates and they are evaluated
 * on every read, so a right that expires stops counting at that moment,
 * not when the cache refreshes. Whoever writes entitlements calls
 * `invalidateEntitlements`; with several server processes, the others
 * catch up within ENTITLEMENT_CACHE_MS.
 */

export const ENTITLEMENT_CACHE_MS = 15_000;

type Row = {
  kind: "MODULE" | "LIMIT";
  key: string;
  value: number | null;
  validFrom: Date;
  validUntil: Date | null;
};

type Entry = { rows: Row[]; loadedAt: number };

const cache = new Map<string, Entry>();

/** Clock, replaceable in tests. */
let now: () => number = Date.now;

export type Entitlements = {
  /** Ids of the modules the company may use now. */
  modules: ReadonlySet<string>;
  /** Limits in force now, by key ("active_products", "users"…). */
  limits: ReadonlyMap<string, number>;
  hasModule(moduleId: string): boolean;
  /** Value of a limit; null when the company has no such limit granted. */
  limit(key: string): number | null;
};

async function load(organizationId: string): Promise<Row[]> {
  return forOrganization(organizationId).entitlement.findMany({
    select: {
      kind: true,
      key: true,
      value: true,
      validFrom: true,
      validUntil: true,
    },
  });
}

function effective(rows: Row[], at: number): Entitlements {
  const modules = new Set<string>();
  const limits = new Map<string, number>();
  for (const row of rows) {
    const started = row.validFrom.getTime() <= at;
    const ended = row.validUntil !== null && row.validUntil.getTime() <= at;
    if (!started || ended) continue;
    if (row.kind === "MODULE") modules.add(row.key);
    else if (row.value !== null) limits.set(row.key, row.value);
  }
  return {
    modules,
    limits,
    hasModule: (moduleId) => modules.has(moduleId),
    limit: (key) => limits.get(key) ?? null,
  };
}

/** Modules and limits of the company at this moment. */
export async function getEntitlements(
  organizationId: string,
): Promise<Entitlements> {
  const at = now();
  let entry = cache.get(organizationId);
  if (!entry || at - entry.loadedAt >= ENTITLEMENT_CACHE_MS) {
    entry = { rows: await load(organizationId), loadedAt: at };
    cache.set(organizationId, entry);
  }
  return effective(entry.rows, at);
}

/** Same as getEntitlements, always from the database (for writes and quotas). */
export async function getFreshEntitlements(
  organizationId: string,
): Promise<Entitlements> {
  invalidateEntitlements(organizationId);
  return getEntitlements(organizationId);
}

/** Forgets the cached rows of a company (or of all). Call after writing entitlements. */
export function invalidateEntitlements(organizationId?: string): void {
  if (organizationId === undefined) cache.clear();
  else cache.delete(organizationId);
}

/** For tests: replaces the clock; returns a function that restores it. */
export function setEntitlementClock(clock: () => number): () => void {
  const previous = now;
  now = clock;
  return () => {
    now = previous;
  };
}

/** Anything that can read entitlements: a client or one of its transactions. */
export type LimitReader = {
  entitlement: {
    findFirst(args: {
      where: object;
      select: { value: true };
    }): PromiseLike<{ value: number | null } | null>;
  };
};

/**
 * Value of a limit in force now, read with the caller's own client. Use it
 * inside transactions: asking through another connection while holding a
 * lock can leave every connection waiting for the next one.
 */
export async function readLimit(
  client: LimitReader,
  organizationId: string,
  key: string,
): Promise<number | null> {
  const at = new Date();
  const row = await client.entitlement.findFirst({
    where: {
      organizationId,
      kind: "LIMIT",
      key,
      validFrom: { lte: at },
      OR: [{ validUntil: null }, { validUntil: { gt: at } }],
    },
    select: { value: true },
  });
  return row?.value ?? null;
}
