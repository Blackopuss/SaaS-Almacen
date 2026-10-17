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
import { getProductSupplier } from "@/modules/purchasing";
import { getModuleAccess } from "@/platform/billing";
import { listPresentations } from "@/platform/catalog";

import { updateProductSupplierAction } from "../actions";
import { LinkForm } from "../link-form";

export const metadata: Metadata = { title: "Editar vínculo" };

/** Editing how a supplier sells a product (CMP-03). */
export default async function EditarVinculoPage({
  params,
}: PageProps<"/compras/proveedores/[id]/productos/[linkId]">) {
  const access = await getModuleAccess();
  const { id, linkId } = await params;
  const back = (
    <Link
      href={`/compras/proveedores/${id}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Proveedor
    </Link>
  );
  if (!access.can("purchasing.product_supplier.update")) {
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
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const link = await getProductSupplier(actor, linkId);
  // The link must be of the supplier the address names.
  if (!link || link.supplierId !== id) notFound();
  const presentations = access.can("inventory.presentation.read")
    ? await listPresentations(actor, link.productId)
    : [];

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Editar vínculo"
        description={`${link.productName} (${link.sku}) con ${link.supplierName}`}
      />
      <LinkForm
        action={updateProductSupplierAction.bind(
          null,
          link.supplierId,
          link.id,
        )}
        initial={{
          supplierSku: link.supplierSku ?? "",
          presentationId: link.presentation?.id ?? "",
        }}
        presentations={presentations.map((presentation) => ({
          id: presentation.id,
          label: presentation.label,
        }))}
        unitName={link.unitName}
        submitLabel="Guardar cambios"
        cancelHref={`/compras/proveedores/${link.supplierId}`}
      />
    </PageContainer>
  );
}
