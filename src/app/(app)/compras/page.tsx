import { ChevronRight, ShoppingCart, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

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

// Orders arrive with CMP-04; suppliers are already here (CMP-02).
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
      {access.can("purchasing.supplier.read") && (
        <Link
          href="/compras/proveedores"
          className="flex min-h-16 max-w-3xl items-center gap-3 rounded-xl border bg-card p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5"
        >
          <Truck
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Proveedores</span>
            <span className="block text-sm text-muted-foreground">
              A quién le compras: nombre, RFC y datos de contacto.
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </Link>
      )}
      <EmptyState
        icon={ShoppingCart}
        title="Sin órdenes de compra"
        description="Crea una orden para un proveedor; al recibirla, tu inventario se actualiza solo."
      />
    </PageContainer>
  );
}
