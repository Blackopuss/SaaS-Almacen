import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { getModuleAccess } from "@/platform/billing";
import { getProduct, listProductGroups } from "@/platform/catalog";

import { updateProductAction } from "../../actions";
import { ProductForm } from "../../product-form";

export const metadata: Metadata = { title: "Editar producto" };

/** Card of a product (INV-03). Quantities are never edited here. */
export default async function EditarProductoPage({
  params,
}: PageProps<"/inventario/[id]/editar">) {
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
  if (!access.can("inventory.product.update")) {
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

  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const { id } = await params;
  const [product, groups] = await Promise.all([
    getProduct(actor, id),
    listProductGroups(actor),
  ]);
  if (!product) notFound();

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Editar producto"
        description="Cambia los datos de la ficha. Las existencias no se editan aquí: se mueven con entradas, salidas y ajustes."
      />
      <ProductForm
        action={updateProductAction.bind(null, product.id)}
        initial={{
          sku: product.sku,
          name: product.name,
          description: product.description ?? "",
          category: product.category ?? "",
          brand: product.brand ?? "",
          barcode: product.barcode ?? "",
        }}
        submitLabel="Guardar cambios"
        categories={groups.categories}
        brands={groups.brands}
      />
    </PageContainer>
  );
}
