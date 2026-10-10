import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Truck,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getModuleAccess } from "@/platform/billing";
import { listSuppliers } from "@/platform/contacts";

export const metadata: Metadata = { title: "Proveedores" };

/**
 * Suppliers of the company (CMP-02): the list, a page at a time, with a
 * search over name and RFC kept in the address.
 */
export default async function ProveedoresPage({
  searchParams,
}: PageProps<"/compras/proveedores">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/compras"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Compras
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
  const { q, pagina } = await searchParams;
  const list = await listSuppliers(
    { organizationId: access.organization.id, userId: access.user.id },
    {
      search: typeof q === "string" ? q : undefined,
      page:
        typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
          ? Number(pagina)
          : undefined,
    },
  );
  const { search } = list;
  const count = (n: number) => n.toLocaleString("es-MX");
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (page > 1) params.set("pagina", String(page));
    const query = params.toString();
    return query ? `/compras/proveedores?${query}` : "/compras/proveedores";
  };
  const addButton = access.allows("purchasing.supplier.create") ? (
    <Button asChild>
      <Link href="/compras/proveedores/nuevo">
        <Plus aria-hidden="true" data-icon="inline-start" />
        Agregar proveedor
      </Link>
    </Button>
  ) : undefined;

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Compras" />}
      <PageHeader
        title="Proveedores"
        description="A quién le compras: sus datos para pedirle y recibirle."
        actions={addButton}
      />
      {(list.total > 0 || search) && (
        <Form
          action="/compras/proveedores"
          role="search"
          className="flex max-w-3xl flex-wrap items-center gap-2"
        >
          <label htmlFor="q" className="sr-only">
            Buscar proveedores
          </label>
          <Input
            className="min-w-48 flex-[2_1_12rem]"
            id="q"
            name="q"
            type="search"
            defaultValue={search}
            // The page keeps the box when the search changes: remount it so
            // it shows what was applied.
            key={search}
            placeholder="Nombre o RFC"
            maxLength={100}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
          />
          <Button type="submit" variant="outline">
            <Search aria-hidden="true" data-icon="inline-start" />
            Buscar
          </Button>
          {search && (
            <Button asChild variant="ghost">
              <Link href="/compras/proveedores">
                <X aria-hidden="true" data-icon="inline-start" />
                Quitar búsqueda
              </Link>
            </Button>
          )}
        </Form>
      )}

      {list.total === 0 ? (
        search ? (
          <EmptyState
            icon={Search}
            title="No encontramos proveedores"
            description="Ninguno coincide. Revisa cómo está escrito o busca con menos palabras."
          />
        ) : (
          <EmptyState
            icon={Truck}
            title="Todavía no hay proveedores"
            description="Agrega a quién le compras para poder hacerle órdenes de compra."
            action={addButton}
          />
        )
      ) : (
        <section
          aria-label="Lista de proveedores"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <p className="border-b px-4 py-2 text-sm text-muted-foreground tabular-nums sm:px-5">
            {list.total === 1
              ? "1 proveedor"
              : `${count(list.total)} proveedores`}
            {search && ` con «${search}»`}
          </p>
          <ul className="divide-y">
            {list.items.map((supplier) => (
              <li key={supplier.id}>
                <Link
                  href={`/compras/proveedores/${supplier.id}`}
                  className="flex min-h-16 items-center gap-3 p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">
                      {supplier.name}
                    </span>
                    <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {[
                        supplier.rfc,
                        supplier.contactPerson,
                        supplier.phone,
                        supplier.email,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sin datos de contacto"}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
          {list.pageCount > 1 && (
            <nav
              aria-label="Páginas de proveedores"
              className="flex items-center justify-between gap-3 border-t p-4 sm:px-5"
            >
              {list.page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(list.page - 1)} rel="prev">
                    <ChevronLeft aria-hidden="true" data-icon="inline-start" />
                    Anterior
                  </Link>
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-sm text-muted-foreground tabular-nums">
                Página {count(list.page)} de {count(list.pageCount)}
              </p>
              {list.page < list.pageCount ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(list.page + 1)} rel="next">
                    Siguiente
                    <ChevronRight aria-hidden="true" data-icon="inline-end" />
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
