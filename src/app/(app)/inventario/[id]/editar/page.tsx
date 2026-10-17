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
import {
  getProduct,
  getUnit,
  listPresentations,
  listProductGroups,
} from "@/platform/catalog";

import {
  changePresentationFactorAction,
  createPresentationAction,
  updateProductAction,
} from "../../actions";
import { PresentationsPanel } from "../../presentations-panel";
import { ProductForm } from "../../product-form";
import { ArchiveProduct } from "../../product-status";
import { stepOptions, unitGroups } from "../../unit-options";

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
  const [product, groups, presentations] = await Promise.all([
    getProduct(actor, id),
    listProductGroups(actor),
    access.can("inventory.presentation.read")
      ? listPresentations(actor, id)
      : Promise.resolve([]),
  ]);
  if (!product) notFound();
  // An archived product is changed only after bringing it back.
  if (product.status === "ARCHIVED") {
    return (
      <PageContainer>
        {back}
        <PageHeader
          title={product.name}
          description="Este producto está archivado. Reactívalo desde la lista de archivados para editarlo."
        />
      </PageContainer>
    );
  }

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
          unit: product.unitCode,
          step: String(Number(product.quantityStep)),
        }}
        submitLabel="Guardar cambios"
        categories={groups.categories}
        brands={groups.brands}
        unitGroups={unitGroups()}
        stepOptions={stepOptions()}
      />
      {access.can("inventory.presentation.read") && (
        <PresentationsPanel
          action={createPresentationAction.bind(null, product.id)}
          presentations={presentations.map((p) => ({
            id: p.id,
            label: p.label,
            version: p.version,
          }))}
          changeAction={
            access.allows("inventory.presentation.update")
              ? changePresentationFactorAction.bind(null, product.id)
              : undefined
          }
          unitPlural={getUnit(product.unitCode).plural}
          canAdd={access.allows("inventory.presentation.create")}
        />
      )}
      {access.allows("inventory.product.archive") && (
        <section
          aria-labelledby="archivar"
          className="max-w-2xl space-y-3 rounded-xl border bg-card p-4 sm:p-6"
        >
          <h2 id="archivar" className="font-medium">
            Archivar
          </h2>
          <p className="text-sm text-muted-foreground">
            Si ya no manejas este producto, archívalo: libera un lugar de tu
            plan y conserva su historial.
          </p>
          <ArchiveProduct productId={product.id} name={product.name} />
        </section>
      )}
    </PageContainer>
  );
}
