import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DEFAULT_AFTER_SIGN_IN, requireSession } from "@/platform/auth";
import { MEXICO_TIME_ZONES, hasOrganization } from "@/platform/tenancy";

import { CreateOrganizationForm } from "./create-organization-form";

export const metadata: Metadata = { title: "Crea tu empresa" };

/** First step after confirming the email (PLT-10). */
export default async function CrearEmpresaPage() {
  const { user } = await requireSession();
  if (await hasOrganization(user.id)) redirect(DEFAULT_AFTER_SIGN_IN);
  return (
    <CreateOrganizationForm
      userName={user.name}
      timeZones={MEXICO_TIME_ZONES.map(({ id, label }) => ({ id, label }))}
    />
  );
}
