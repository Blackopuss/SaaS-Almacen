import { Package } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  PageContainer,
  PageHeader,
} from "@/components";
import { getAccess } from "@/platform/authorization";

export const metadata: Metadata = { title: "Inventario" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function InventarioPage() {
  const access = await getAccess();
  if (!access.can("inventory.product.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
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
