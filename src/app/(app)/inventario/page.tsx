import { Package } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageContainer, PageHeader } from "@/components";
import { requireSession } from "@/platform/auth";

export const metadata: Metadata = { title: "Inventario" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function InventarioPage() {
  await requireSession();
  return (
    <PageContainer>
      <PageHeader
        title="Inventario"
        description="Qué hay, cuánto y dónde está."
      />
      <EmptyState
        icon={Package}
        title="Todavía no hay productos"
        description="Agrega tu primer producto o importa tu Excel para empezar."
      />
    </PageContainer>
  );
}
