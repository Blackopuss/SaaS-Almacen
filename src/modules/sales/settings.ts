import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertOwnerAction } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization, type TenantDb } from "@/server";

import {
  DEFAULT_DISCOUNT_CAPS,
  DISCOUNT_CAP_ROLES,
  PERCENT_ERROR,
  formatPercent,
  parsePercent,
  type DiscountCaps,
} from "./discounts";
import type { SalesActor } from "./prices";
import {
  DEFAULT_TAX_RULE,
  TAX_RATE_ERROR,
  formatTaxRate,
  parseTaxRate,
  type TaxRule,
} from "./tax";

/**
 * How a company sells (VEN-04, VEN-14, ADR 0030): whether its prices
 * include VAT and at what rate, and the largest discount each role gives
 * without asking. Only the titular changes it; every sale reads it.
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

/** The discount cap of each role, in a sale's transaction or outside. */
export async function readDiscountCaps(
  client: Client,
  organizationId: string,
): Promise<DiscountCaps> {
  const row = await client.salesSettings.findFirst({
    where: { organizationId },
    select: {
      discountCapCashier: true,
      discountCapCashManager: true,
      discountCapAdministrator: true,
    },
  });
  return row
    ? {
        cashier: row.discountCapCashier.toFixed(2),
        cash_manager: row.discountCapCashManager.toFixed(2),
        administrator: row.discountCapAdministrator.toFixed(2),
      }
    : DEFAULT_DISCOUNT_CAPS;
}

export type SalesSettings = TaxRule & { caps: DiscountCaps };

/** The settings, for the titular's screen. */
export async function getSalesSettings(
  actor: SalesActor,
): Promise<SalesSettings> {
  await assertSettingsOwner(actor);
  const client = forOrganization(actor.organizationId);
  const [rule, caps] = await Promise.all([
    readTaxRule(client, actor.organizationId),
    readDiscountCaps(client, actor.organizationId),
  ]);
  return { ...rule, caps };
}

export type SalesSettingsInput = {
  /** "included" or "added". */
  taxMode: string;
  /** As typed: «16». */
  taxRate: string;
  /** Discount caps by role, as typed; absent = unchanged. */
  caps?: Partial<Record<keyof DiscountCaps, string>>;
};

export type SalesSettingsField =
  "taxMode" | "taxRate" | `cap.${keyof DiscountCaps}`;

export type SalesSettingsResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      reason: "invalid";
      fieldErrors: Partial<Record<SalesSettingsField, string>>;
    };

export async function updateSalesSettings(
  actor: SalesActor,
  input: SalesSettingsInput,
): Promise<SalesSettingsResult> {
  await assertSettingsOwner(actor);
  const fieldErrors: Partial<Record<SalesSettingsField, string>> = {};
  const mode = String(input.taxMode ?? "");
  if (mode !== "included" && mode !== "added") {
    fieldErrors.taxMode = "Elige si tus precios ya incluyen IVA o no.";
  }
  const rate = parseTaxRate(String(input.taxRate ?? "").slice(0, 16));
  if (rate === null) fieldErrors.taxRate = TAX_RATE_ERROR;
  const typedCaps: Partial<DiscountCaps> = {};
  for (const role of DISCOUNT_CAP_ROLES) {
    const typed = input.caps?.[role];
    if (typed === undefined) continue;
    const cap = parsePercent(String(typed).slice(0, 16));
    if (cap === null) fieldErrors[`cap.${role}`] = PERCENT_ERROR;
    else typedCaps[role] = cap;
  }
  if (rate === null || Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: "invalid", fieldErrors };
  }
  const wantedRule: TaxRule = { pricesIncludeTax: mode === "included", rate };

  const save = () =>
    forOrganization(actor.organizationId).$transaction(async (tx) => {
      const current = await tx.salesSettings.findFirst({
        where: { organizationId: actor.organizationId },
        select: { id: true },
      });
      const before: Settings = {
        ...(await readTaxRule(tx, actor.organizationId)),
        caps: await readDiscountCaps(tx, actor.organizationId),
      };
      const wanted: Settings = {
        ...wantedRule,
        caps: { ...before.caps, ...typedCaps },
      };
      if (describe(before) === describe(wanted)) {
        return { ok: true as const, changed: false };
      }
      const data = {
        pricesIncludeTax: wanted.pricesIncludeTax,
        taxRate: wanted.rate,
        discountCapCashier: wanted.caps.cashier,
        discountCapCashManager: wanted.caps.cash_manager,
        discountCapAdministrator: wanted.caps.administrator,
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

type Settings = TaxRule & { caps: DiscountCaps };

/** «IVA 16 % incluido · descuentos: Cajero 5 %, …», for the audit trail. */
const describe = (settings: Settings) =>
  `IVA ${formatTaxRate(settings.rate)} ${settings.pricesIncludeTax ? "incluido" : "sumado"} · descuentos: Cajero ${formatPercent(settings.caps.cashier)}, Encargado de caja ${formatPercent(settings.caps.cash_manager)}, Administrador ${formatPercent(settings.caps.administrator)}`;

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
