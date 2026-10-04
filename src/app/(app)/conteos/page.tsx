import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
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
  const moduleState = access.moduleState("inventory");
  if (moduleState === "none") {
    return (
      <PageContainer>
        <NoModuleState module="Inventario" />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
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
