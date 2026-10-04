import "server-only";

import { getSeatUsage, type SeatUsage } from "@/platform/authorization";
import {
  getFreshEntitlements,
  getQuotaUsage,
  type QuotaUsageSummary,
} from "@/platform/entitlements";
import { forOrganization } from "@/server";

import type { ModuleRegistry } from "./registry";

/**
 * What a company has contracted, for the «Mi plan» screen (MOD-10): quotas
 * with their use, modules and until when. Read-only.
 */

export type PlanModule = {
  id: string;
  name: string;
  /**
   * active: the company has it. read_only: it had it; its data can be
   * consulted and exported (MOD-11). available: it could be added.
   * unavailable: announced, not sold yet.
   */
  state: "active" | "read_only" | "available" | "unavailable";
  required: boolean;
  /** End of the right when active and it has one. */
  validUntil: Date | null;
};

export type PlanOverview = {
  /** False when nothing has been assigned to the company yet. */
  hasPlan: boolean;
  /**
   * active: at least one module in full use. read_only: everything the
   * company had ended or its subscription stopped. none: never had a plan.
   */
  status: "active" | "read_only" | "none";
  /** The subscription needs payment but still works. */
  paymentNotice: boolean;
  products: QuotaUsageSummary;
  seats: SeatUsage;
  modules: PlanModule[];
  /** Earliest end among what is in force; null = no end date. */
  validUntil: Date | null;
};

/** Share of a limit in use, 0–100; 100 when there is no room or no limit. */
export function usagePercent(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/** Warning level of a quota: none below 80%, then 80, 90 and 100. */
export function usageLevel(
  used: number,
  limit: number | null,
): "ok" | "high" | "almost" | "full" {
  if (limit === null) return "ok";
  if (used >= limit) return "full";
  const share = limit > 0 ? used / limit : 1;
  if (share >= 0.9) return "almost";
  if (share >= 0.8) return "high";
  return "ok";
}

export async function getPlanOverview(
  registry: ModuleRegistry,
  organizationId: string,
): Promise<PlanOverview> {
  const now = new Date();
  const [entitlements, products, seats, rows] = await Promise.all([
    getFreshEntitlements(organizationId),
    getQuotaUsage(organizationId, "active_products"),
    getSeatUsage(organizationId),
    forOrganization(organizationId).entitlement.findMany({
      where: {
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: { kind: true, key: true, validUntil: true },
    }),
  ]);
  const active = new Map(
    rows.filter((r) => r.kind === "MODULE").map((r) => [r.key, r.validUntil]),
  );
  const ends = rows
    .map((r) => r.validUntil)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const status =
    entitlements.modules.size > 0
      ? "active"
      : entitlements.readOnlyModules.size > 0
        ? "read_only"
        : "none";
  return {
    hasPlan: status !== "none",
    status,
    paymentNotice: entitlements.paymentNotice,
    products,
    seats,
    modules: registry.all.map((contract) => {
      const state = entitlements.moduleState(contract.id);
      return {
        id: contract.id,
        name: contract.name,
        required: contract.required,
        state:
          state !== "none"
            ? state
            : contract.availability === "available"
              ? "available"
              : "unavailable",
        validUntil:
          state === "active" ? (active.get(contract.id) ?? null) : null,
      };
    }),
    validUntil: status === "active" ? (ends[0] ?? null) : null,
  };
}
