import { ChevronLeft, CircleCheck, Pencil } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getModuleAccess } from "@/platform/billing";
import { getSupplier } from "@/platform/contacts";

export const metadata: Metadata = { title: "Proveedor" };

/** Card of a supplier (CMP-02). */
export default async function ProveedorPage({
  params,
  searchParams,
}: PageProps<"/compras/proveedores/[id]">) {
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
  if (!access.can("purchasing.supplier.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("purchasing");
  if (moduleState === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Compras" />
      </PageContainer>
    );
  }
  const { id } = await params;
  const supplier = await getSupplier(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!supplier) notFound();
  const { guardado } = await searchParams;
  const canEdit =
    moduleState === "active" && access.allows("purchasing.supplier.update");
  const rows: [string, string | null][] = [
    ["Razón social", supplier.legalName],
    ["RFC", supplier.rfc],
    ["Persona de contacto", supplier.contactPerson],
    ["Teléfono", supplier.phone],
    ["Correo", supplier.email],
    ["Dirección", supplier.address],
    ["Notas", supplier.notes],
  ];

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Compras" />}
      <PageHeader
        title={supplier.name}
        description="Proveedor"
        actions={
          canEdit ? (
            <Button asChild variant="outline">
              <Link href={`/compras/proveedores/${supplier.id}/editar`}>
                <Pencil aria-hidden="true" data-icon="inline-start" />
                Editar
              </Link>
            </Button>
          ) : undefined
        }
      />
      {(guardado === "nuevo" || guardado === "cambios") && (
        <div
          role="status"
          className="flex max-w-2xl items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <p>
            {guardado === "nuevo"
              ? "Proveedor guardado."
              : "Cambios guardados."}
          </p>
        </div>
      )}
      <section
        aria-label="Datos del proveedor"
        className="max-w-2xl rounded-xl border bg-card"
      >
        {(supplier.isCustomer || supplier.archived) && (
          <p className="flex flex-wrap gap-2 border-b p-4 sm:px-5">
            {supplier.isCustomer && (
              <Badge variant="secondary">También es cliente</Badge>
            )}
            {supplier.archived && <Badge variant="warning">Archivado</Badge>}
          </p>
        )}
        <dl className="divide-y">
          {rows.map(([term, value]) => (
            <div
              key={term}
              className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr] sm:gap-4 sm:px-5"
            >
              <dt className="text-sm text-muted-foreground">{term}</dt>
              <dd
                className={`[overflow-wrap:anywhere] whitespace-pre-line ${value ? "" : "text-muted-foreground"}`}
              >
                {value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </PageContainer>
  );
}
