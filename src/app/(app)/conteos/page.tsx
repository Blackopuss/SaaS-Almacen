import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageContainer, PageHeader } from "@/components";

export const metadata: Metadata = { title: "Conteos" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default function ConteosPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Conteos"
        description="Compara lo que hay físicamente con el sistema."
      />
      <EmptyState
        icon={ClipboardCheck}
        title="Sin conteos"
        description="Inicia un conteo físico para detectar diferencias y ajustarlas con trazabilidad."
      />
    </PageContainer>
  );
}
