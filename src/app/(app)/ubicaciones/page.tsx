import { MapPin } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  PageContainer,
  PageHeader,
} from "@/components";
import { getAccess } from "@/platform/authorization";

export const metadata: Metadata = { title: "Ubicaciones" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function UbicacionesPage() {
  const access = await getAccess();
  if (!access.can("inventory.location.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
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
