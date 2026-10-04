import { ArrowLeftRight } from "lucide-react";
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

export const metadata: Metadata = { title: "Movimientos" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function MovimientosPage() {
  const access = await getModuleAccess();
  if (!access.can("inventory.movement.read")) {
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
        title="Movimientos"
        description="Entradas, salidas, reubicaciones y ajustes."
      />
      <EmptyState
        icon={ArrowLeftRight}
        title="Sin movimientos registrados"
        description="Cada entrada, salida o reubicación aparecerá aquí con su autor y motivo."
      />
    </PageContainer>
  );
}
