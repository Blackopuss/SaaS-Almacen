import "server-only";

import { newId } from "@/lib";
import { forOrganization, type TenantDb } from "@/server";

import { getFreshEntitlements, readLimit } from "./entitlements";

/**
 * Quota counters (MOD-07). One row per company and limit keeps how much is
 * taken: what exists plus what is reserved. Taking a place is one
 * conditional UPDATE (`taken <= limit - amount`), which the database runs
 * under a row lock: with 99 of 100, two simultaneous requests cannot both
 * win.
 *
 * Callers pass their own company client or transaction, so the counter and
 * the thing counted (a product, an invitation) are written together: if
 * the transaction fails, the place is not consumed.
 *
 * Reservations hold places for work that will finish later (an import):
 * `reserveQuota` → `confirmReservation` for each item created, and
 * `releaseReservation` for what was not used.
 */

/** Limit keys counted here. The entitlement of the same key sets the limit. */
export const QUOTA_KEYS = ["active_products", "users"] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];

/** A company client or one of its transactions. */
export type QuotaClient = Pick<TenantDb, "quotaUsage" | "entitlement">;

export type QuotaResult =
  | { ok: true }
  | {
      ok: false;
      reason: "limit_reached";
      /** Null when the company has no such limit granted. */
      limit: number | null;
      /** In use + reserved when the request was refused. */
      taken: number;
    };

function checkAmount(amount: number) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    throw new Error(`Invalid quota amount ${amount}`);
  }
}

/**
 * Creates the counters of a company that do not exist yet. Call it where
 * a limit is granted (provisioning), with the company row locked, so the
 * counter is already there when the first product or person arrives.
 */
export async function ensureQuotaRows(
  client: {
    quotaUsage: {
      createMany(args: {
        data: { id: string; organizationId: string; key: string }[];
        skipDuplicates: true;
      }): PromiseLike<unknown>;
    };
  },
  organizationId: string,
  keys: readonly QuotaKey[] = QUOTA_KEYS,
): Promise<void> {
  await client.quotaUsage.createMany({
    data: keys.map((key) => ({ id: newId(), organizationId, key })),
    skipDuplicates: true,
  });
}

/**
 * Makes sure the counter exists before it is updated. It looks first and
 * inserts only when the row is missing: an `INSERT IGNORE` that finds the
 * row leaves a shared lock on it until the transaction ends, and two
 * transactions holding that lock deadlock when each goes on to update
 * the counter. Reading takes no lock, so in the normal case — the row
 * exists since the plan was set — nothing here can collide.
 */
async function ensureRow(
  client: QuotaClient,
  organizationId: string,
  key: QuotaKey,
) {
  const existing = await client.quotaUsage.findFirst({
    where: { key },
    select: { id: true },
  });
  if (existing) return;
  await client.quotaUsage.createMany({
    data: [{ id: newId(), organizationId, key }],
    skipDuplicates: true,
  });
}

async function takenNow(client: QuotaClient, key: QuotaKey) {
  const row = await client.quotaUsage.findFirst({
    where: { key },
    select: { taken: true },
  });
  return row?.taken ?? 0;
}

async function take(
  client: QuotaClient,
  organizationId: string,
  key: QuotaKey,
  amount: number,
  reserve: boolean,
): Promise<QuotaResult> {
  checkAmount(amount);
  // Read with the client of the caller: inside a transaction, no second
  // connection is needed.
  const limit = await readLimit(client, organizationId, key);
  if (limit === null) {
    return { ok: false, reason: "limit_reached", limit, taken: 0 };
  }
  await ensureRow(client, organizationId, key);
  const updated = await client.quotaUsage.updateMany({
    where: { key, taken: { lte: limit - amount } },
    data: {
      taken: { increment: amount },
      ...(reserve ? { reserved: { increment: amount } } : {}),
    },
  });
  if (updated.count === 1) return { ok: true };
  return {
    ok: false,
    reason: "limit_reached",
    limit,
    taken: await takenNow(client, key),
  };
}

/** Takes `amount` places for things created now (a new or reactivated product). */
export function consumeQuota(
  client: QuotaClient,
  organizationId: string,
  key: QuotaKey,
  amount = 1,
): Promise<QuotaResult> {
  return take(client, organizationId, key, amount, false);
}

/** Holds `amount` places for work that finishes later (a confirmed import). */
export function reserveQuota(
  client: QuotaClient,
  organizationId: string,
  key: QuotaKey,
  amount: number,
): Promise<QuotaResult> {
  return take(client, organizationId, key, amount, true);
}

/**
 * Turns reserved places into used ones, as each reserved item is created.
 * False when there were not that many reserved (nothing changes).
 */
export async function confirmReservation(
  client: QuotaClient,
  key: QuotaKey,
  amount = 1,
): Promise<boolean> {
  checkAmount(amount);
  const updated = await client.quotaUsage.updateMany({
    where: { key, reserved: { gte: amount } },
    data: { reserved: { decrement: amount } },
  });
  return updated.count === 1;
}

/** Gives back reserved places that were not used. False when there were not that many. */
export async function releaseReservation(
  client: QuotaClient,
  key: QuotaKey,
  amount: number,
): Promise<boolean> {
  checkAmount(amount);
  const updated = await client.quotaUsage.updateMany({
    where: { key, reserved: { gte: amount }, taken: { gte: amount } },
    data: { reserved: { decrement: amount }, taken: { decrement: amount } },
  });
  return updated.count === 1;
}

/**
 * Frees places in use (a product archived). False when that would free
 * more than is in use; reserved places are never freed this way.
 */
export async function releaseQuota(
  client: QuotaClient,
  key: QuotaKey,
  amount = 1,
): Promise<boolean> {
  checkAmount(amount);
  try {
    const updated = await client.quotaUsage.updateMany({
      where: { key, taken: { gte: amount } },
      data: { taken: { decrement: amount } },
    });
    return updated.count === 1;
  } catch (error) {
    // The database refuses to go below what is reserved.
    if (String(error).includes("quota_usage_values_check")) return false;
    throw error;
  }
}

export type QuotaUsageSummary = {
  /** Null when the company has no such limit granted. */
  limit: number | null;
  /** Things that exist and count. */
  used: number;
  /** Places held by work in progress. */
  reserved: number;
  /** Places left; 0 without a limit or when over it. */
  available: number;
};

/** Usage of one limit, for screens («Productos activos: 84 de 100»). */
export async function getQuotaUsage(
  organizationId: string,
  key: QuotaKey,
): Promise<QuotaUsageSummary> {
  const [entitlements, row] = await Promise.all([
    getFreshEntitlements(organizationId),
    forOrganization(organizationId).quotaUsage.findFirst({
      where: { key },
      select: { taken: true, reserved: true },
    }),
  ]);
  const limit = entitlements.limit(key);
  const taken = row?.taken ?? 0;
  const reserved = row?.reserved ?? 0;
  return {
    limit,
    used: taken - reserved,
    reserved,
    available: limit === null ? 0 : Math.max(0, limit - taken),
  };
}
