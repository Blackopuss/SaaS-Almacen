import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Package,
  Pencil,
  Plus,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { getModuleAccess } from "@/platform/billing";
import { listProducts } from "@/platform/catalog";

import { ReactivateProduct } from "./product-status";

export const metadata: Metadata = { title: "Inventario" };

/** Catalog of the company, one page at a time (INV-10). Search arrives with INV-11. */
export default async function InventarioPage({
  searchParams,
}: PageProps<"/inventario">) {
  const access = await getModuleAccess();
  if (!access.can("inventory.product.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState === "none") {
    return (
      <PageContainer>
        <NoModuleState module="Inventario" />
      </PageContainer>
    );
  }

  const { creado, guardado, archivado, archivados, pagina } =
    await searchParams;
  const showArchived = archivados === "1";
  const created = typeof creado === "string" ? creado.slice(0, 64) : "";
  const saved = typeof guardado === "string" ? guardado.slice(0, 64) : "";
  const canEdit = access.allows("inventory.product.update");
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const requested =
    typeof pagina === "string" && /^\d{1,6}$/.test(pagina) ? Number(pagina) : 1;
  const list = await listProducts(actor, {
    status: showArchived ? "ARCHIVED" : "ACTIVE",
    page: requested,
  });
  const products = list.items;
  const first = (list.page - 1) * list.pageSize + 1;
  const last = first + products.length - 1;
  const count = (n: number) => n.toLocaleString("es-MX");
  /** Address of a page of this same list; the first one stays clean. */
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (showArchived) params.set("archivados", "1");
    if (page > 1) params.set("pagina", String(page));
    const query = params.toString();
    return query ? `/inventario?${query}` : "/inventario";
  };
  const canReactivate = access.allows("inventory.product.reactivate");
  // Shown only to who may add products, and only while the plan allows it.
  const addButton = access.allows("inventory.product.create") ? (
    <Button asChild>
      <Link href="/inventario/nuevo">
        <Plus aria-hidden="true" data-icon="inline-start" />
        Agregar producto
      </Link>
    </Button>
  ) : undefined;

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Inventario"
        description="Qué hay, cuánto y dónde está."
        actions={addButton}
      />
      {created && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <p>
            Producto <span className="font-medium">{created}</span> guardado.
            Sus existencias se registran con una entrada.
          </p>
        </div>
      )}
      {archivado === "1" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <p>Producto archivado. Liberó un lugar de tu plan.</p>
        </div>
      )}
      {saved && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <p>
            Cambios de <span className="font-medium">{saved}</span> guardados.
          </p>
        </div>
      )}
      <p>
        <Link
          href={showArchived ? "/inventario" : "/inventario?archivados=1"}
          className="inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {showArchived ? "Ver productos activos" : "Ver productos archivados"}
        </Link>
      </p>
      {products.length === 0 ? (
        showArchived ? (
          <EmptyState
            icon={Package}
            title="No hay productos archivados"
            description="Los productos que archives aparecerán aquí y podrás reactivarlos."
          />
        ) : (
          <EmptyState
            icon={Package}
            title="Todavía no hay productos"
            description="Agrega tu primer producto para empezar a controlar tu inventario."
            action={addButton}
          />
        )
      ) : (
        <section
          aria-labelledby="lista-productos"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="lista-productos" className="font-medium">
              {showArchived ? "Productos archivados" : "Productos"}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {list.total === 1
                ? "1 producto"
                : `${count(first)}–${count(last)} de ${count(list.total)} productos`}
            </p>
          </div>
          <ul className="divide-y">
            {products.map((product) => (
              <li
                key={product.id}
                className="flex items-center gap-3 p-4 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{product.name}</p>
                  <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    {[product.sku, product.category, product.brand]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {showArchived && canReactivate && (
                  <ReactivateProduct
                    productId={product.id}
                    name={product.name}
                  />
                )}
                {!showArchived && canEdit && (
                  <Button asChild variant="ghost">
                    <Link
                      href={`/inventario/${product.id}/editar`}
                      aria-label={`Editar ${product.name}`}
                    >
                      <Pencil aria-hidden="true" />
                      <span className="hidden sm:inline">Editar</span>
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {list.pageCount > 1 && (
            <nav
              aria-label="Páginas de la lista"
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
