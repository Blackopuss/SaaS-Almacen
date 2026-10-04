import { ArrowLeftRight } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  PageContainer,
  PageHeader,
} from "@/components";
import { getAccess } from "@/platform/authorization";

export const metadata: Metadata = { title: "Movimientos" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function MovimientosPage() {
  const access = await getAccess();
  if (!access.can("inventory.movement.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
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
