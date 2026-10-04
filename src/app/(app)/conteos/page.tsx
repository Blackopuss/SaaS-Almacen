import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  PageContainer,
  PageHeader,
} from "@/components";
import { getAccess } from "@/platform/authorization";

export const metadata: Metadata = { title: "Conteos" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function ConteosPage() {
  const access = await getAccess();
  if (!access.can("inventory.count.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
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
