import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { getModuleAccess } from "@/platform/billing";

import { createSupplierAction } from "../actions";
import { EMPTY_SUPPLIER, SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Nuevo proveedor" };

/** New supplier (CMP-02). */
export default async function NuevoProveedorPage() {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/compras/proveedores"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Proveedores
    </Link>
  );
  if (!access.can("purchasing.supplier.create")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("purchasing");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        {back}
        {moduleState === "none" ? (
          <NoModuleState module="Compras" />
        ) : (
          <ReadOnlyNotice module="Compras" />
        )}
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Nuevo proveedor"
        description="Solo el nombre es obligatorio. Lo demás lo puedes completar después."
      />
      <SupplierForm
        action={createSupplierAction}
        initial={EMPTY_SUPPLIER}
        submitLabel="Guardar proveedor"
        cancelHref="/compras/proveedores"
      />
    </PageContainer>
  );
}
