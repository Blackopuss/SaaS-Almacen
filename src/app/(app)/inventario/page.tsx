import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Package,
  Plus,
  Search,
  Upload,
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
import {
  countLowStock,
  formatStock,
  getStockTotals,
} from "@/modules/inventory";
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
  // Total of each product on this page (the sum of its locations).
  const totals = access.can("inventory.stock.read")
    ? await getStockTotals(
        actor,
        [...products, ...(list.exact ? [list.exact] : [])].map((p) => p.id),
      )
    : null;
  const lowCount =
    !showArchived &&
    access.can("inventory.minimum.read") &&
    access.can("inventory.stock.read")
      ? await countLowStock(actor)
      : null;
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
  // The whole row opens the product: its card has every action (KISS),
  // so the list carries no small per-row buttons.
  const row = (product: ProductSummary) => (
    <li
      key={product.id}
      className="relative flex min-h-16 items-center gap-3 p-4 hover:bg-muted/50 sm:px-5"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          <Link
            href={`/inventario/${product.id}`}
            className="rounded underline-offset-4 outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {product.name}
          </Link>
        </p>
        <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
          {[product.sku, product.category, product.brand]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {totals && (
        <p className="shrink-0 text-right font-medium tabular-nums">
          {formatStock(totals[product.id] ?? "0", product.unitCode)}
        </p>
      )}
      {showArchived && canReactivate && (
        <div className="relative z-10">
          <ReactivateProduct productId={product.id} name={product.name} />
        </div>
      )}
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
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
  const canImport = access.allows("inventory.import.create");
  const importButton =
    canImport && !showArchived ? (
      <Button asChild variant="outline">
        <Link href="/inventario/importar">
          <Upload aria-hidden="true" data-icon="inline-start" />
          Importar Excel
        </Link>
      </Button>
    ) : undefined;
  const quietLink =
    "inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title={showArchived ? "Productos archivados" : "Inventario"}
        actions={
          !showArchived && (addButton || importButton) ? (
            <>
              {addButton}
              {importButton}
            </>
          ) : undefined
        }
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
      {lowCount !== null && lowCount > 0 && (
        <Link
          href="/inventario/bajas"
          className="flex min-h-11 items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm outline-none hover:bg-warning/15 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex-1">
            {lowCount === 1
              ? "1 producto se está acabando."
              : `${lowCount.toLocaleString("es-MX")} productos se están acabando.`}
          </span>
          <span className="font-medium text-primary">Ver cuáles</span>
        </Link>
      )}
      {(list.total > 0 || narrowed) && (
        <Form
          action="/inventario"
          role="search"
          className="flex flex-wrap items-center gap-2"
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
            <div className="flex w-full flex-wrap gap-2 lg:w-auto">
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
                  : "Revisa cómo está escrito o busca con menos palabras."
            }
          />
        ) : showArchived ? (
          <EmptyState
            icon={Package}
            title="No hay productos archivados"
            description="Aquí verás los productos que archives."
          />
        ) : (
          <EmptyState
            icon={Package}
            title="Todavía no hay productos"
            description={
              canImport
                ? "Sube tu Excel para traerlos todos de una vez, o agrega el primero a mano."
                : "Agrega tu primer producto para empezar."
            }
            action={
              canImport ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {addButton}
                  {importButton}
                </div>
              ) : (
                addButton
              )
            }
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
      {/* Now-and-then options, out of the way of the daily list. */}
      <p className="flex flex-wrap gap-x-6">
        {!showArchived && access.can("inventory.export.create") && (
          <Link href="/inventario/exportar" className={quietLink}>
            Descargar en Excel
          </Link>
        )}
        <Link
          href={showArchived ? "/inventario" : "/inventario?archivados=1"}
          className={quietLink}
        >
          {showArchived ? "Ver productos activos" : "Ver archivados"}
        </Link>
      </p>
    </PageContainer>
  );
}
