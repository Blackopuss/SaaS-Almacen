import { ShoppingCart } from "lucide-react";
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

export const metadata: Metadata = { title: "Compras" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function ComprasPage() {
  const access = await getModuleAccess();
  if (!access.can("purchasing.order.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("purchasing");
  if (moduleState === "none") {
    return (
      <PageContainer>
        <NoModuleState module="Compras" />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Compras" />}
      <PageHeader
        title="Compras"
        description="Órdenes a proveedores y recepciones."
      />
      <EmptyState
        icon={ShoppingCart}
        title="Sin órdenes de compra"
        description="Crea una orden para un proveedor; al recibirla, tu inventario se actualiza solo."
      />
    </PageContainer>
  );
}
