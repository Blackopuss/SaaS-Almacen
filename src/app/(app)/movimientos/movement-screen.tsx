import { ChevronLeft, ChevronRight, Package, Search } from "lucide-react";
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
  formatStock,
  getStockByLocation,
  getStockTotals,
  listStockLocations,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";
import {
  getProduct,
  listPresentations,
  listProducts,
} from "@/platform/catalog";

import { captureOptions } from "./capture-options";
import { EntryForm } from "./entrada/entry-form";

const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

/** What changes between registering an entry and an exit. */
const KINDS = {
  entry: {
    path: "/movimientos/entrada",
    permission: "inventory.entry.create",
    title: "Registrar entrada",
    find: "Busca el producto que llegó.",
    searchLabel: "Buscar el producto que entra",
    archived: "Reactívalo en Inventario para registrar entradas.",
  },
  exit: {
    path: "/movimientos/salida",
    permission: "inventory.exit.create",
    title: "Registrar salida",
    find: "Busca el producto que sale.",
    searchLabel: "Buscar el producto que sale",
    archived: "Reactívalo en Inventario para registrar salidas.",
  },
} as const;

/**
 * Screen of an entry (INV-16/17) or an exit (INV-19): first the product is
 * found, then the quantity (in its unit, a presentation or another unit)
 * and the location are captured.
 */
export async function MovementScreen({
  kind,
  searchParams,
}: {
  kind: keyof typeof KINDS;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const texts = KINDS[kind];
  const access = await getModuleAccess();
  const back = (
    <Link href="/movimientos" className={linkClass}>
      <ChevronLeft aria-hidden="true" className="size-4" />
      Movimientos
    </Link>
  );
  if (!access.can(texts.permission)) {
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
  const { producto, q } = await searchParams;

  if (typeof producto !== "string" || producto === "") {
    const list = await listProducts(actor, {
      search: typeof q === "string" ? q : "",
      pageSize: 10,
    });
    // What was scanned or typed exactly goes first.
    const products = list.exact
      ? [list.exact, ...list.items.filter((p) => p.id !== list.exact?.id)]
      : list.items;
    const totals = await getStockTotals(
      actor,
      products.map((p) => p.id),
    );
    return (
      <PageContainer>
        {back}
        <PageHeader title={texts.title} description={texts.find} />
        <Form
          action={texts.path}
          role="search"
          className="flex max-w-xl items-center gap-2"
        >
          <label htmlFor="q" className="sr-only">
            {texts.searchLabel}
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={list.search}
            key={list.search}
            placeholder="Nombre, clave o código de barras"
            maxLength={100}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            autoFocus
          />
          <Button type="submit" variant="outline">
            <Search aria-hidden="true" data-icon="inline-start" />
            Buscar
          </Button>
        </Form>
        {products.length === 0 ? (
          <EmptyState
            icon={list.search ? Search : Package}
            title={
              list.search
                ? "No encontramos productos"
                : "Todavía no hay productos"
            }
            description={
              list.search
                ? "Ningún producto activo coincide. Revisa cómo está escrito o agrégalo primero en Inventario."
                : "Agrega tus productos en Inventario para registrar sus movimientos."
            }
          />
        ) : (
          <section
            aria-labelledby="elige-producto"
            className="rounded-xl border bg-card"
          >
            <h2
              id="elige-producto"
              className="border-b p-4 font-medium sm:px-5"
            >
              {list.search ? "Elige el producto" : "Tus primeros productos"}
            </h2>
            <ul className="divide-y">
              {products.map((product) => (
                <li key={product.id}>
                  <Link
                    href={`${texts.path}?producto=${product.id}`}
                    className="flex min-h-16 items-center gap-3 p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{product.name}</span>
                      <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                        {product.sku} · Hay{" "}
                        {formatStock(
                          totals[product.id] ?? "0",
                          product.unitCode,
                        )}
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
            {list.total > products.length && (
              <p className="border-t p-4 text-sm text-muted-foreground sm:px-5">
                Hay más productos: escribe parte del nombre o la clave para
                encontrarlo.
              </p>
            )}
          </section>
        )}
      </PageContainer>
    );
  }

  const another = (
    <Link href={texts.path} className={linkClass}>
      <ChevronLeft aria-hidden="true" className="size-4" />
      Elegir otro producto
    </Link>
  );
  const product = await getProduct(actor, producto);
  if (!product || product.status !== "ACTIVE") {
    return (
      <PageContainer>
        {another}
        <EmptyState
          icon={Package}
          title={
            product ? "Este producto está archivado" : "Este producto no existe"
          }
          description={
            product
              ? texts.archived
              : "Puede que se haya archivado o que la dirección esté incompleta."
          }
        />
      </PageContainer>
    );
  }
  const [locations, stock, totals, presentations] = await Promise.all([
    listStockLocations(actor),
    getStockByLocation(actor, product.id),
    getStockTotals(actor, [product.id]),
    access.can("inventory.presentation.read")
      ? listPresentations(actor, product.id)
      : [],
  ]);
  const total = totals[product.id];
  const header = (
    <PageHeader
      title={texts.title}
      description={`${product.name} · ${product.sku}`}
    />
  );
  const holding = (id: string) =>
    formatStock(stock[id] ?? "0", product.unitCode);

  if (kind === "exit") {
    // Stock only leaves from where there is some.
    const sources = locations.filter((location) => stock[location.id]);
    if (sources.length === 0) {
      return (
        <PageContainer>
          {another}
          {header}
          <EmptyState
            icon={Package}
            title="No hay existencias de este producto"
            description="No hay nada que sacar. Si acaba de llegar, registra primero su entrada."
            action={
              access.allows("inventory.entry.create") ? (
                <Button asChild variant="outline">
                  <Link href={`/movimientos/entrada?producto=${product.id}`}>
                    Registrar una entrada
                  </Link>
                </Button>
              ) : undefined
            }
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        {another}
        {header}
        <p className="text-sm text-muted-foreground">
          Hoy hay {formatStock(total ?? "0", product.unitCode)} en total.
        </p>
        <EntryForm
          mode="exit"
          productId={product.id}
          captures={captureOptions(product, presentations)}
          locations={sources.map((location) => ({
            id: location.id,
            label: `${location.path} — hay ${holding(location.id)}`,
          }))}
          defaultLocationId={sources[0]?.id ?? ""}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {another}
      {header}
      <p className="text-sm text-muted-foreground">
        {total
          ? `Hoy hay ${formatStock(total, product.unitCode)} en total.`
          : "Todavía no tiene existencias."}
      </p>
      <EntryForm
        productId={product.id}
        captures={captureOptions(product, presentations)}
        locations={locations.map((location) => ({
          id: location.id,
          label: stock[location.id]
            ? `${location.path} — hay ${holding(location.id)}`
            : location.path,
        }))}
        defaultLocationId={
          locations.find((location) => location.isDefault)?.id ??
          locations[0]?.id ??
          ""
        }
      />
    </PageContainer>
  );
}
