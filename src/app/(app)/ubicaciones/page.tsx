import { MapPin } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageContainer, PageHeader } from "@/components";

export const metadata: Metadata = { title: "Ubicaciones" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default function UbicacionesPage() {
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
