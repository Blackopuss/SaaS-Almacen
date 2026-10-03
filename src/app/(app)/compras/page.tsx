import { ShoppingCart } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageContainer, PageHeader } from "@/components";

export const metadata: Metadata = { title: "Compras" };

// Placeholder until its step in docs/PLAN_IMPLEMENTACION.md.
export default function ComprasPage() {
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
