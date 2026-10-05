import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Package,
  Pencil,
  Plus,
  Search,
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
import {
  listProductFilterOptions,
  listProducts,
  type ProductSummary,
} from "@/platform/catalog";

import { FilterSelect } from "./filter-select";
import { ReactivateProduct } from "./product-status";

export const metadata: Metadata = { title: "Inventario" };

/** Value of the filters that means «products without category / brand». */
const NONE = "sin";

/** Catalog of the company, one page at a time (INV-10), with search (INV-11) and filters (INV-12). */
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

  const {
    creado,
    guardado,
    archivado,
    archivados,
    pagina,
    q,
    categoria,
    marca,
  } = await searchParams;
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
  const filters = await listProductFilterOptions(actor);
  /** A filter of the address, kept only if it is one of the company's. */
  const chosen = (value: unknown, options: { id: string }[]) =>
    value === NONE || options.some((option) => option.id === value)
      ? (value as string)
      : "";
  const category = chosen(categoria, filters.categories);
  const brand = chosen(marca, filters.brands);
  const filterValue = (value: string) =>
    value === "" ? undefined : value === NONE ? null : value;
  const list = await listProducts(actor, {
    status: showArchived ? "ARCHIVED" : "ACTIVE",
    page: requested,
    search: typeof q === "string" ? q : "",
    categoryId: filterValue(category),
    brandId: filterValue(brand),
  });
  const narrowed = Boolean(list.search || category || brand);
  const categoryName =
    category === NONE
      ? "sin categoría"
      : filters.categories.find((option) => option.id === category)?.name;
  const brandName =
    brand === NONE
      ? "sin marca"
      : filters.brands.find((option) => option.id === brand)?.name;
  const search = list.search;
  const products = list.items;
  const first = (list.page - 1) * list.pageSize + 1;
  const last = first + products.length - 1;
  const count = (n: number) => n.toLocaleString("es-MX");
  /** Address of a page of this same list; the first one stays clean. */
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (showArchived) params.set("archivados", "1");
    if (search) params.set("q", search);
    if (category) params.set("categoria", category);
    if (brand) params.set("marca", brand);
    if (page > 1) params.set("pagina", String(page));
    const query = params.toString();
    return query ? `/inventario?${query}` : "/inventario";
  };
  const canReactivate = access.allows("inventory.product.reactivate");
  const row = (product: ProductSummary) => (
    <li key={product.id} className="flex items-center gap-3 p-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{product.name}</p>
        <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
          {[product.sku, product.category, product.brand]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {showArchived && canReactivate && (
        <ReactivateProduct productId={product.id} name={product.name} />
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
  );
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
      {(list.total > 0 || narrowed) && (
        <Form
          action="/inventario"
          role="search"
          className="flex max-w-3xl flex-wrap items-center gap-2"
        >
          {showArchived && <input type="hidden" name="archivados" value="1" />}
          <label htmlFor="q" className="sr-only">
            {showArchived
              ? "Buscar en productos archivados"
              : "Buscar productos"}
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
            placeholder="Nombre, clave o código de barras"
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
          {(filters.categories.length > 0 || filters.brands.length > 0) && (
            <div className="flex w-full flex-wrap gap-2">
              {filters.categories.length > 0 && (
                <FilterSelect
                  id="categoria"
                  name="categoria"
                  label="Filtrar por categoría"
                  value={category}
                  allLabel="Categoría"
                  noneLabel="Sin categoría"
                  options={filters.categories}
                />
              )}
              {filters.brands.length > 0 && (
                <FilterSelect
                  id="marca"
                  name="marca"
                  label="Filtrar por marca"
                  value={brand}
                  allLabel="Marca"
                  noneLabel="Sin marca"
                  options={filters.brands}
                />
              )}
            </div>
          )}
        </Form>
      )}
      {narrowed && (
        <p className="text-sm" role="status">
          {list.total === 0
            ? "Sin resultados"
            : list.total === 1
              ? "1 resultado"
              : `${count(list.total)} resultados`}
          {search && (
            <>
              {" "}
              para <span className="font-medium">«{search}»</span>
            </>
          )}
          {categoryName && (
            <>
              {" "}
              · Categoría: <span className="font-medium">{categoryName}</span>
            </>
          )}
          {brandName && (
            <>
              {" "}
              · Marca: <span className="font-medium">{brandName}</span>
            </>
          )}
          .{" "}
          <Link
            href={showArchived ? "/inventario?archivados=1" : "/inventario"}
            className="inline-flex min-h-11 items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {category || brand ? "Quitar filtros" : "Quitar búsqueda"}
          </Link>
        </p>
      )}
      {list.exact &&
        !(list.total === 1 && products[0]?.id === list.exact.id) && (
          <section
            aria-labelledby="coincidencia-exacta"
            className="rounded-xl border border-primary/40 bg-card"
          >
            <h2
              id="coincidencia-exacta"
              className="border-b p-4 text-sm font-medium text-muted-foreground sm:px-5"
            >
              Coincidencia exacta de clave o código de barras
            </h2>
            <ul>{row(list.exact)}</ul>
          </section>
        )}
      {products.length === 0 ? (
        narrowed ? (
          <EmptyState
            icon={Search}
            title="No encontramos productos"
            description={
              category || brand
                ? "Ningún producto coincide con esos filtros. Quita alguno o busca con menos palabras."
                : showArchived
                  ? "Ningún producto archivado coincide. Revisa cómo está escrito o busca con menos palabras."
                  : "Ningún producto coincide. Revisa cómo está escrito, busca con menos palabras o mira en los archivados."
            }
          />
        ) : showArchived ? (
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
          <ul className="divide-y">{products.map(row)}</ul>
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
