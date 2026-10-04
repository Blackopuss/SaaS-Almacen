import { MapPin } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Ubicaciones" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function UbicacionesPage() {
  const access = await getModuleAccess();
  if (!access.can("inventory.location.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  if (!access.hasModule("inventory")) {
    return (
      <PageContainer>
        <NoModuleState module="Inventario" />
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
