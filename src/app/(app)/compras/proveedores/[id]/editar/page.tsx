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
import { getSupplier } from "@/platform/contacts";

import { updateSupplierAction } from "../../actions";
import { SupplierForm } from "../../supplier-form";

export const metadata: Metadata = { title: "Editar proveedor" };

/** Editing the card of a supplier (CMP-02). */
export default async function EditarProveedorPage({
  params,
}: PageProps<"/compras/proveedores/[id]/editar">) {
  const access = await getModuleAccess();
  const { id } = await params;
  const back = (
    <Link
      href={`/compras/proveedores/${id}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Proveedor
    </Link>
  );
  if (!access.can("purchasing.supplier.update")) {
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
  const supplier = await getSupplier(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!supplier) notFound();

  return (
    <PageContainer>
      {back}
      <PageHeader title="Editar proveedor" description={supplier.name} />
      <SupplierForm
        action={updateSupplierAction.bind(null, supplier.id)}
        initial={{
          name: supplier.name,
          legalName: supplier.legalName ?? "",
          rfc: supplier.rfc ?? "",
          contactPerson: supplier.contactPerson ?? "",
          email: supplier.email ?? "",
          phone: supplier.phone ?? "",
          address: supplier.address ?? "",
          notes: supplier.notes ?? "",
        }}
        submitLabel="Guardar cambios"
        cancelHref={`/compras/proveedores/${supplier.id}`}
      />
    </PageContainer>
  );
}
