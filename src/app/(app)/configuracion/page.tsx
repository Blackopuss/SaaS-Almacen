import { Settings } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageContainer, PageHeader } from "@/components";
import { requireSession } from "@/platform/auth";

export const metadata: Metadata = { title: "Configuración" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function ConfiguracionPage() {
  await requireSession();
  return (
    <PageContainer>
      <PageHeader
        title="Configuración"
        description="Tu negocio, usuarios y plan."
      />
      <EmptyState
        icon={Settings}
        title="Configuración en preparación"
        description="Aquí administrarás tu negocio, tu equipo y tu plan."
      />
    </PageContainer>
  );
}
