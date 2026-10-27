import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertOwnerAction } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization, type TenantDb } from "@/server";

import type { SalesActor } from "./prices";
import {
  DEFAULT_TAX_RULE,
  TAX_RATE_ERROR,
  formatTaxRate,
  parseTaxRate,
  type TaxRule,
} from "./tax";

/**
 * How a company sells (VEN-04, ADR 0030): whether its prices include VAT
 * and at what rate. Only the titular changes it; every sale reads it.
 */

/** The company client or a transaction of it. */
type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/**
 * The VAT rule of a company, with the client in hand (a sale reads it in
 * its own transaction). Without a row, VAT 16 % included.
 */
export async function readTaxRule(
  client: Client,
  organizationId: string,
): Promise<TaxRule> {
  const row = await client.salesSettings.findFirst({
    where: { organizationId },
    select: { pricesIncludeTax: true, taxRate: true },
  });
  return row
    ? { pricesIncludeTax: row.pricesIncludeTax, rate: row.taxRate.toFixed(2) }
    : DEFAULT_TAX_RULE;
}

/** The settings, for the titular's screen. */
export async function getSalesSettings(actor: SalesActor): Promise<TaxRule> {
  await assertSettingsOwner(actor);
  return readTaxRule(
    forOrganization(actor.organizationId),
    actor.organizationId,
  );
}

export type SalesSettingsInput = {
  /** "included" or "added". */
  taxMode: string;
  /** As typed: «16». */
  taxRate: string;
};

export type SalesSettingsResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      reason: "invalid";
      fieldErrors: Partial<Record<"taxMode" | "taxRate", string>>;
    };

export async function updateSalesSettings(
  actor: SalesActor,
  input: SalesSettingsInput,
): Promise<SalesSettingsResult> {
  await assertSettingsOwner(actor);
  const fieldErrors: Partial<Record<"taxMode" | "taxRate", string>> = {};
  const mode = String(input.taxMode ?? "");
  if (mode !== "included" && mode !== "added") {
    fieldErrors.taxMode = "Elige si tus precios ya incluyen IVA o no.";
  }
  const rate = parseTaxRate(String(input.taxRate ?? "").slice(0, 16));
  if (rate === null) fieldErrors.taxRate = TAX_RATE_ERROR;
  if (rate === null || Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "invalid", fieldErrors };
  }
  const wanted: TaxRule = { pricesIncludeTax: mode === "included", rate };

  const save = () =>
    forOrganization(actor.organizationId).$transaction(async (tx) => {
      const current = await tx.salesSettings.findFirst({
        where: { organizationId: actor.organizationId },
        select: { id: true, pricesIncludeTax: true, taxRate: true },
      });
      const before = current
        ? {
            pricesIncludeTax: current.pricesIncludeTax,
            rate: current.taxRate.toFixed(2),
          }
        : DEFAULT_TAX_RULE;
      if (
        before.pricesIncludeTax === wanted.pricesIncludeTax &&
        before.rate === wanted.rate
      ) {
        return { ok: true as const, changed: false };
      }
      const data = {
        pricesIncludeTax: wanted.pricesIncludeTax,
        taxRate: wanted.rate,
        updatedByUserId: actor.userId,
      };
      if (current) {
        await tx.salesSettings.updateMany({
          where: { id: current.id },
          data,
        });
      } else {
        // Two saves at once: the second fails on the unique company and
        // is retried below, then it finds the row.
        await tx.salesSettings.create({
          data: { id: newId(), organizationId: actor.organizationId, ...data },
        });
      }
      await recordAuditEvent(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "sales.settings_changed",
        target: { type: "organization", id: actor.organizationId },
        metadata: {
          before: describe(before),
          after: describe(wanted),
        },
      });
      return { ok: true as const, changed: true };
    });

  try {
    return await save();
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return save();
    throw error;
  }
}

const describe = (rule: TaxRule) =>
  `IVA ${formatTaxRate(rule.rate)} ${rule.pricesIncludeTax ? "incluido" : "sumado"}`;

async function assertSettingsOwner(actor: SalesActor) {
  await assertOwnerAction(
    actor.organizationId,
    actor.userId,
    "sales.settings.update",
  );
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.settings.update",
  );
}
