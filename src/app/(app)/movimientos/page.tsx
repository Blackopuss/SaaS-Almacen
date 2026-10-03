import { ArrowLeftRight } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageContainer, PageHeader } from "@/components";

export const metadata: Metadata = { title: "Movimientos" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default function MovimientosPage() {
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
