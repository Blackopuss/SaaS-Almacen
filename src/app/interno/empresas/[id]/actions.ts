"use server";

import { revalidatePath } from "next/cache";

import { moduleOpenWork, moduleRegistry } from "@/modules/registry";
import {
  provisionCompany,
  requirePlatformStaff,
  type ProvisionField,
} from "@/platform/billing";

export type ProvisionState = {
  fieldErrors: Partial<Record<ProvisionField, string>>;
  formError?: string;
  saved?: boolean;
  /** Modules being removed with work halfway (CMP-17). */
  openWork?: { module: string; lines: string[] }[];
  /** What was typed, so a rejected form keeps it (React resets forms). */
  values?: { modules: string[]; validUntil: string; reason: string };
};

/** End of the chosen day in central Mexico (UTC-6, no daylight saving). */
function endOfDay(value: string): Date | null | "invalid" {
  if (value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "invalid";
  const date = new Date(`${value}T23:59:59.999-06:00`);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

/**
 * Assigns the plan of a company. The staff member comes from the session;
 * the company id is the one bound by the page, never trusted on its own:
 * the service checks that the caller is platform staff.
 */
export async function provisionAction(
  organizationId: string,
  _prev: ProvisionState,
  formData: FormData,
): Promise<ProvisionState> {
  const staff = await requirePlatformStaff();
  const values = {
    modules: formData.getAll("modules").map(String),
    validUntil: String(formData.get("validUntil") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  };
  const validUntil = endOfDay(values.validUntil);
  if (validUntil === "invalid") {
    return {
      fieldErrors: { validUntil: "Elige una fecha válida." },
      values,
    };
  }
  const result = await provisionCompany(
    moduleRegistry,
    staff.userId,
    String(organizationId),
    {
      productLimit: String(formData.get("productLimit") ?? ""),
      users: String(formData.get("users") ?? ""),
      modules: values.modules,
      validUntil,
      reason: values.reason,
    },
    {
      openWork: moduleOpenWork,
      acceptOpenWork: formData.get("acceptOpenWork") === "1",
    },
  );
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      openWork: result.openWork,
      values,
    };
  }
  revalidatePath(`/interno/empresas/${organizationId}`);
  return { fieldErrors: {}, saved: true };
}
