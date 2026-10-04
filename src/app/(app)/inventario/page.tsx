import { Package } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Inventario" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function InventarioPage() {
  const access = await getModuleAccess();
  if (!access.can("inventory.product.read")) {
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
