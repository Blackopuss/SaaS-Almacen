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
import { listProductGroups } from "@/platform/catalog";

import { ProductForm } from "./product-form";

export const metadata: Metadata = { title: "Nuevo producto" };

/** New product (INV-02). */
export default async function NuevoProductoPage() {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/inventario"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Inventario
    </Link>
  );
  if (!access.can("inventory.product.create")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        {back}
        {moduleState === "none" ? (
          <NoModuleState module="Inventario" />
        ) : (
          <ReadOnlyNotice module="Inventario" />
        )}
      </PageContainer>
    );
  }

  const groups = await listProductGroups({
    organizationId: access.organization.id,
    userId: access.user.id,
  });
  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Nuevo producto"
        description="Solo la clave y el nombre son obligatorios. Las existencias se registran después con una entrada."
      />
      <ProductForm categories={groups.categories} brands={groups.brands} />
    </PageContainer>
  );
}
