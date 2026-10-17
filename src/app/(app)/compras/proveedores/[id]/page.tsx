import { ChevronLeft, CircleCheck, Pencil, Plus } from "lucide-react";
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
import { formatDate } from "@/lib";
import { listProductsOfSupplier } from "@/modules/purchasing";
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
  const { guardado, pagina } = await searchParams;
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  // What it sells (CMP-03); costs come only for who may see them.
  const links = access.can("purchasing.product_supplier.read")
    ? await listProductsOfSupplier(actor, supplier.id, {
        page:
          typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
            ? Number(pagina)
            : undefined,
      })
    : null;
  const canLink =
    moduleState === "active" &&
    !supplier.archived &&
    access.allows("purchasing.product_supplier.create") &&
    access.can("inventory.product.read");
  const canEditLink =
    moduleState === "active" &&
    access.allows("purchasing.product_supplier.update");
  const linkButton = canLink ? (
    <Button asChild variant="outline">
      <Link href={`/compras/proveedores/${supplier.id}/productos/nuevo`}>
        <Plus aria-hidden="true" data-icon="inline-start" />
        Vincular producto
      </Link>
    </Button>
  ) : null;
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
      {(guardado === "nuevo" ||
        guardado === "cambios" ||
        guardado === "vinculo") && (
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
              : guardado === "vinculo"
                ? "Producto guardado en este proveedor."
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

      {links && (
        <section
          aria-labelledby="productos-proveedor"
          className="max-w-2xl rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-5">
            <h2 id="productos-proveedor" className="font-medium">
              Productos que te vende
              {links.total > 0 && (
                <span className="font-normal text-muted-foreground tabular-nums">
                  {" "}
                  · {links.total.toLocaleString("es-MX")}
                </span>
              )}
            </h2>
            {linkButton}
          </div>
          {links.total === 0 ? (
            <p className="p-4 text-sm text-muted-foreground sm:px-5">
              Todavía no has dicho qué productos te vende. Vincúlalos para tener
              a la mano su código y cómo se lo compras.
            </p>
          ) : (
            <ul className="divide-y">
              {links.items.map((link) => (
                <li
                  key={link.id}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-4 sm:px-5"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {access.can("inventory.product.read") ? (
                        <Link
                          href={`/inventario/${link.productId}`}
                          className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {link.productName}
                        </Link>
                      ) : (
                        link.productName
                      )}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {link.sku}
                      </span>
                      {link.productArchived && (
                        <Badge variant="warning" className="ml-2">
                          Archivado
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {link.supplierSku
                        ? `Su código: ${link.supplierSku}`
                        : "Sin código del proveedor"}{" "}
                      · Se compra por{" "}
                      {link.presentation
                        ? link.presentation.text
                        : link.unitName}
                    </p>
                    {links.costsVisible && (
                      <p className="text-sm tabular-nums">
                        {link.lastCost ? (
                          <>
                            Último costo: {link.lastCost.text}{" "}
                            <span className="text-muted-foreground">
                              (
                              <time dateTime={link.lastCost.at.toISOString()}>
                                {formatDate(
                                  link.lastCost.at,
                                  access.organization.timeZone,
                                )}
                              </time>
                              )
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            Sin costo todavía: se anota al registrar una compra.
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  {canEditLink && (
                    <Button asChild variant="ghost">
                      <Link
                        href={`/compras/proveedores/${supplier.id}/productos/${link.id}`}
                        aria-label={`Editar el vínculo con ${link.productName}`}
                      >
                        <Pencil aria-hidden="true" data-icon="inline-start" />
                        Editar
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {links.pageCount > 1 && (
            <nav
              aria-label="Páginas de productos del proveedor"
              className="flex items-center justify-between gap-3 border-t p-4 sm:px-5"
            >
              {links.page > 1 ? (
                <Button asChild variant="outline">
                  <Link
                    href={`/compras/proveedores/${supplier.id}?pagina=${links.page - 1}`}
                    rel="prev"
                  >
                    Anterior
                  </Link>
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-sm text-muted-foreground tabular-nums">
                Página {links.page} de {links.pageCount}
              </p>
              {links.page < links.pageCount ? (
                <Button asChild variant="outline">
                  <Link
                    href={`/compras/proveedores/${supplier.id}?pagina=${links.page + 1}`}
                    rel="next"
                  >
                    Siguiente
                  </Link>
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
            </nav>
          )}
        </section>
      )}
    </PageContainer>
  );
}
