import { MapPin } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageContainer, PageHeader } from "@/components";
import { requireOrganizationMember } from "@/platform/tenancy";

export const metadata: Metadata = { title: "Ubicaciones" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function UbicacionesPage() {
  await requireOrganizationMember();
  return (
    <PageContainer>
      <PageHeader
        title="Ubicaciones"
        description="Zonas, pasillos y estantes de tu negocio."
      />
      <EmptyState
        icon={MapPin}
        title="Solo existe la ubicación General"
        description="Crea zonas, pasillos o estantes cuando quieras saber dónde está cada producto."
      />
    </PageContainer>
  );
}
