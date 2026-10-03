import "server-only";

import { cache } from "react";
import { z } from "zod";

import { DEFAULT_TIME_ZONE, newId } from "@/lib";
import { db } from "@/server";

/**
 * Companies (PLT-10). A person who signs up creates their company and
 * becomes its titular in one transaction: the organization and the
 * titular's membership exist together or not at all.
 */

/** Where people without a company start. */
export const CREATE_ORGANIZATION_PATH = "/crear-empresa";

/** Mexican time zones (IANA) with names people recognize. */
export const MEXICO_TIME_ZONES = [
  { id: "America/Mexico_City", label: "Centro — Ciudad de México" },
  { id: "America/Cancun", label: "Sureste — Quintana Roo" },
  { id: "America/Mazatlan", label: "Pacífico — Sinaloa, Nayarit, BCS" },
  { id: "America/Hermosillo", label: "Sonora" },
  { id: "America/Tijuana", label: "Noroeste — Baja California" },
  { id: "America/Chihuahua", label: "Chihuahua" },
  { id: "America/Ciudad_Juarez", label: "Ciudad Juárez" },
] as const;

const TIME_ZONE_IDS = MEXICO_TIME_ZONES.map((zone) => zone.id) as [
  string,
  ...string[],
];

export const organizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Escribe el nombre de tu negocio (mínimo 2 caracteres).")
    .max(120, "El nombre es demasiado largo (máximo 120 caracteres)."),
  timeZone: z.enum(TIME_ZONE_IDS, "Elige la zona horaria de tu negocio."),
});

export type OrganizationInput = z.input<typeof organizationSchema>;
export type OrganizationField = keyof OrganizationInput;

export type CreateOrganizationResult =
  | { ok: true; organizationId: string }
  | {
      ok: false;
      fieldErrors: Partial<Record<OrganizationField, string>>;
      formError?: string;
    };

/** Whether the person belongs to at least one company (active member). */
export const hasOrganization = cache(async (userId: string) => {
  const count = await db.membership.count({
    where: { userId, status: "ACTIVE" },
  });
  return count > 0;
});

/**
 * Creates the person's first company with them as titular. Refused when
 * they already belong to one (more than one company per account is not
 * offered yet). Concurrent submissions create at most one company.
 */
export async function createOrganization(
  userId: string,
  input: OrganizationInput,
): Promise<CreateOrganizationResult> {
  const parsed = organizationSchema.safeParse({
    ...input,
    timeZone: input.timeZone || DEFAULT_TIME_ZONE,
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<OrganizationField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as OrganizationField;
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }

  const organizationId = newId();
  const created = await db.$transaction(async (tx) => {
    // Lock the person's row so two submissions cannot both pass the check.
    await tx.$queryRaw`SELECT id FROM user WHERE id = ${userId} FOR UPDATE`;
    const memberships = await tx.membership.count({
      where: { userId, status: "ACTIVE" },
    });
    if (memberships > 0) return false;
    await tx.organization.create({
      data: {
        id: organizationId,
        name: parsed.data.name,
        timeZone: parsed.data.timeZone,
        currency: "MXN",
        ownerUserId: userId,
        memberships: { create: { id: newId(), userId } },
      },
    });
    return true;
  });

  if (!created) {
    return {
      ok: false,
      fieldErrors: {},
      formError: "Tu cuenta ya pertenece a una empresa.",
    };
  }
  return { ok: true, organizationId };
}
