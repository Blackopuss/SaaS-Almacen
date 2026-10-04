import { ShoppingCart } from "lucide-react";
import type { Metadata } from "next";

import {
  EmptyState,
  NoAccessState,
  PageContainer,
  PageHeader,
} from "@/components";
import { getAccess } from "@/platform/authorization";

export const metadata: Metadata = { title: "Compras" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default async function ComprasPage() {
  const access = await getAccess();
  if (!access.can("purchasing.order.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
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
