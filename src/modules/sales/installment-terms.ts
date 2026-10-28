import "server-only";

import { dec, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertOwnerAction } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import { LOCKING_TRANSACTION, forOrganization, type TenantDb } from "@/server";

import { formatPercent, parsePercent } from "./discounts";
import type { SalesActor } from "./prices";

/**
 * Terms of sales on installments (PAG-01, ADR 0030): the months a company
 * offers and, for each, an optional interest — a percent added once to
 * what is financed after the down payment (0 by default). No terms = every
 * sale is cash. Only the titular changes them; a plan copies its interest
 * when agreed, so a change never touches plans already made.
 */

export const MAX_INSTALLMENT_TERMS = 12;
export const MAX_INSTALLMENT_MONTHS = 60;

/** The company client or a transaction of it. */
type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export type InstallmentTerm = {
  months: number;
  /** «0.00», «10.00». */
  interestPercent: string;
};

/** The terms of a company, fewest months first. */
export async function readInstallmentTerms(
  client: Client,
): Promise<InstallmentTerm[]> {
  const rows = await client.salesInstallmentTerm.findMany({
    orderBy: { months: "asc" },
    select: { months: true, interestPercent: true },
  });
  return rows.map((row) => ({
    months: row.months,
    interestPercent: row.interestPercent.toFixed(2),
  }));
}

/** The terms, for whoever quotes or charges in the company. */
export async function getInstallmentTerms(
  actor: SalesActor,
): Promise<InstallmentTerm[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.quote.read",
  );
  return readInstallmentTerms(forOrganization(actor.organizationId));
}

export type InstallmentTermsResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      reason: "invalid";
      /** By position of the row sent. */
      rowErrors: Record<number, string>;
      formError?: string;
    };

/** «3 meses sin interés · 6 meses con 10 %», for the audit trail. */
export const describeTerms = (terms: readonly InstallmentTerm[]) =>
  terms.length === 0
    ? "sin plazos"
    : terms
        .map(
          (term) =>
            `${term.months} ${term.months === 1 ? "mes" : "meses"} ${
              dec(term.interestPercent).isZero()
                ? "sin interés"
                : `con ${formatPercent(term.interestPercent)}`
            }`,
        )
        .join(" · ");

/**
 * Replaces the terms of the company with the rows sent («6» months,
 * «10» % interest; empty interest = 0). Empty rows are skipped.
 */
export async function setInstallmentTerms(
  actor: SalesActor,
  rows: { months: string; interest: string }[],
): Promise<InstallmentTermsResult> {
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
  const sent = Array.isArray(rows)
    ? rows.slice(0, MAX_INSTALLMENT_TERMS + 1)
    : [];
  const rowErrors: Record<number, string> = {};
  const wanted: InstallmentTerm[] = [];
  const seen = new Set<number>();
  sent.forEach((row, index) => {
    const months = String(row?.months ?? "").trim();
    const interest = String(row?.interest ?? "").trim();
    if (months === "" && interest === "") return;
    if (!/^\d{1,2}$/.test(months)) {
      rowErrors[index] =
        `Escribe los meses como un número entero del 1 al ${MAX_INSTALLMENT_MONTHS}.`;
      return;
    }
    const count = Number(months);
    if (count < 1 || count > MAX_INSTALLMENT_MONTHS) {
      rowErrors[index] =
        `Escribe los meses como un número entero del 1 al ${MAX_INSTALLMENT_MONTHS}.`;
      return;
    }
    if (seen.has(count)) {
      rowErrors[index] = `El plazo de ${count} meses ya está arriba.`;
      return;
    }
    const percent = interest === "" ? "0.00" : parsePercent(interest);
    if (percent === null) {
      rowErrors[index] = "Escribe el interés como un número del 0 al 100.";
      return;
    }
    seen.add(count);
    wanted.push({ months: count, interestPercent: percent });
  });
  if (Object.keys(rowErrors).length > 0) {
    return { ok: false, reason: "invalid", rowErrors };
  }
  if (wanted.length > MAX_INSTALLMENT_TERMS) {
    return {
      ok: false,
      reason: "invalid",
      rowErrors: {},
      formError: `Ofrece hasta ${MAX_INSTALLMENT_TERMS} plazos.`,
    };
  }
  wanted.sort((a, b) => a.months - b.months);

  const save = () =>
    forOrganization(actor.organizationId).$transaction(async (tx) => {
      const before = await readInstallmentTerms(tx);
      if (describeTerms(before) === describeTerms(wanted)) {
        return { ok: true as const, changed: false };
      }
      await tx.salesInstallmentTerm.deleteMany({});
      if (wanted.length > 0) {
        await tx.salesInstallmentTerm.createMany({
          data: wanted.map((term) => ({
            id: newId(),
            organizationId: actor.organizationId,
            months: term.months,
            interestPercent: term.interestPercent,
          })),
        });
      }
      await recordAuditEvent(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "sales.installments_changed",
        target: { type: "organization", id: actor.organizationId },
        metadata: {
          before: describeTerms(before),
          after: describeTerms(wanted),
        },
      });
      return { ok: true as const, changed: true };
    }, LOCKING_TRANSACTION);

  try {
    return await save();
  } catch (error) {
    // Two saves at once: the second meets the first's rows and runs again.
    if ((error as { code?: string }).code === "P2002") return save();
    throw error;
  }
}
