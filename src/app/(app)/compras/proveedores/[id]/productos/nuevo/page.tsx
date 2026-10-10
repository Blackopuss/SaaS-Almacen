import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";

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
  getProduct,
  getUnit,
  listPresentations,
  listProducts,
} from "@/platform/catalog";
import { getSupplier } from "@/platform/contacts";

import { linkProductSupplierAction } from "../actions";
import { LinkForm } from "../link-form";

export const metadata: Metadata = { title: "Vincular producto" };

/**
 * Linking a product with a supplier (CMP-03), in two steps: find the
 * product, then say how this supplier sells it. Search and choice live
 * in the address (`?q=`, `?producto=`).
 */
export default async function VincularProductoPage({
  params,
  searchParams,
}: PageProps<"/compras/proveedores/[id]/productos/nuevo">) {
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
  if (
    !access.can("purchasing.product_supplier.create") ||
    !access.can("inventory.product.read")
  ) {
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
  const supplier = await getSupplier(actor, id);
  if (!supplier) notFound();
  const { q, producto } = await searchParams;
  const here = `/compras/proveedores/${supplier.id}/productos/nuevo`;

  // Second step: the product is chosen.
  if (typeof producto === "string" && producto !== "") {
    const product = await getProduct(actor, producto);
    if (!product) notFound();
    const presentations = access.can("inventory.presentation.read")
      ? await listPresentations(actor, product.id)
      : [];
    return (
      <PageContainer>
        {back}
        <PageHeader
          title="Vincular producto"
          description={`${product.name} (${product.sku}) con ${supplier.name}`}
        />
        <LinkForm
          action={linkProductSupplierAction.bind(null, supplier.id, product.id)}
          initial={{ supplierSku: "", presentationId: "" }}
          presentations={presentations.map((presentation) => ({
            id: presentation.id,
            label: presentation.label,
          }))}
          unitName={getUnit(product.unitCode).name}
          submitLabel="Vincular"
          cancelHref={here}
        />
      </PageContainer>
    );
  }

  // First step: find the product.
  const list = await listProducts(actor, {
    search: typeof q === "string" ? q : undefined,
    pageSize: 10,
  });
  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Vincular producto"
        description={`Busca el producto que te vende ${supplier.name}.`}
      />
      <Form
        action={here}
        role="search"
        className="flex max-w-3xl flex-wrap items-center gap-2"
      >
        <label htmlFor="q" className="sr-only">
          Buscar el producto que te vende
        </label>
        <Input
          className="min-w-48 flex-[2_1_12rem]"
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
        />
        <Button type="submit" variant="outline">
          <Search aria-hidden="true" data-icon="inline-start" />
          Buscar
        </Button>
      </Form>
      {list.items.length === 0 ? (
        <EmptyState
          icon={Search}
          title={
            list.search
              ? "No encontramos productos"
              : "Todavía no hay productos"
          }
          description={
            list.search
              ? "Ningún producto activo coincide. Revisa cómo está escrito o agrégalo primero en Inventario."
              : "Agrega tus productos en Inventario para vincularlos con sus proveedores."
          }
        />
      ) : (
        <section
          aria-labelledby="elige-producto"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <h2 id="elige-producto" className="border-b p-4 font-medium sm:px-5">
            {list.search ? "Elige el producto" : "Tus primeros productos"}
          </h2>
          <ul className="divide-y">
            {list.items.map((product) => (
              <li key={product.id}>
                <Link
                  href={`${here}?producto=${product.id}`}
                  className="flex min-h-16 items-center gap-3 p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">
                      {product.name}
                    </span>
                    <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {product.sku}
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
          {list.total > list.items.length && (
            <p className="border-t p-4 text-sm text-muted-foreground sm:px-5">
              Se muestran {list.items.length} de{" "}
              {list.total.toLocaleString("es-MX")}. Busca por nombre o clave
              para encontrar los demás.
            </p>
          )}
        </section>
      )}
    </PageContainer>
  );
}
