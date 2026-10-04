import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Conteos" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function ConteosPage() {
  const access = await getModuleAccess();
  if (!access.can("inventory.count.read")) {
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
