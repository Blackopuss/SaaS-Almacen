import { ChevronLeft, ChevronRight, Package, Search } from "lucide-react";
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
  formatStock,
  getStockByLocation,
  getStockTotals,
  listStockLocations,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";
import {
  getProduct,
  getUnit,
  listPresentations,
  listProducts,
  unitsOfDimension,
} from "@/platform/catalog";

import { EntryForm } from "./entry-form";

export const metadata: Metadata = { title: "Registrar entrada" };

const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Entry of stock (INV-16/17): first the product is found, then the
 * quantity (in its unit, a presentation or another unit) and the location.
 */
export default async function EntradaPage({
  searchParams,
}: PageProps<"/movimientos/entrada">) {
  const access = await getModuleAccess();
  const back = (
    <Link href="/movimientos" className={linkClass}>
      <ChevronLeft aria-hidden="true" className="size-4" />
      Movimientos
    </Link>
  );
  if (!access.can("inventory.entry.create")) {
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
        <PageHeader
          title="Registrar entrada"
          description="Busca el producto que llegó."
        />
        <Form
          action="/movimientos/entrada"
          role="search"
          className="flex max-w-xl items-center gap-2"
        >
          <label htmlFor="q" className="sr-only">
            Buscar el producto que entra
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
                : "Agrega tus productos en Inventario para registrar sus entradas."
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
                    href={`/movimientos/entrada?producto=${product.id}`}
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

  const product = await getProduct(actor, producto);
  if (!product || product.status !== "ACTIVE") {
    return (
      <PageContainer>
        {back}
        <EmptyState
          icon={Package}
          title={
            product ? "Este producto está archivado" : "Este producto no existe"
          }
          description={
            product
              ? "Reactívalo en Inventario para registrar entradas."
              : "Puede que se haya archivado o que la dirección esté incompleta."
          }
          action={
            <Button asChild variant="outline">
              <Link href="/movimientos/entrada">Buscar otro producto</Link>
            </Button>
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
  const unit = getUnit(product.unitCode);
  const total = totals[product.id];
  // "0.010" → 2 decimals; "1" → none. Text only: quantities are never floats.
  const decimals = (product.quantityStep.split(".")[1] ?? "").replace(
    /0+$/,
    "",
  ).length;

  const capital = (text: string) =>
    text.charAt(0).toUpperCase() + text.slice(1);
  /** Ways to count what arrives; the content of a box is only shown here. */
  const captures = [
    {
      value: "base",
      label: capital(unit.plural),
      hint:
        decimals === 0
          ? `En ${unit.plural}, sin fracciones.`
          : `En ${unit.plural}, hasta ${decimals} ${decimals === 1 ? "decimal" : "decimales"}.`,
    },
    ...presentations.map((presentation) => ({
      value: `p:${presentation.id}`,
      label: presentation.label,
      hint: `${presentation.label}. Se capturan completas.`,
    })),
    ...unitsOfDimension(unit.dimension)
      .filter((other) => other.code !== unit.code)
      .map((other) => ({
        value: `u:${other.code}`,
        label: capital(other.plural),
        hint: `En ${other.plural}; se guarda en ${unit.plural}.`,
      })),
  ];

  return (
    <PageContainer>
      <Link href="/movimientos/entrada" className={linkClass}>
        <ChevronLeft aria-hidden="true" className="size-4" />
        Elegir otro producto
      </Link>
      <PageHeader
        title="Registrar entrada"
        description={`${product.name} · ${product.sku}`}
      />
      <p className="text-sm text-muted-foreground">
        {total
          ? `Hoy hay ${formatStock(total, product.unitCode)} en total.`
          : "Todavía no tiene existencias."}
      </p>
      <EntryForm
        productId={product.id}
        captures={captures}
        locations={locations.map((location) => ({
          id: location.id,
          label: stock[location.id]
            ? `${location.path} — hay ${formatStock(stock[location.id] ?? "0", product.unitCode)}`
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
