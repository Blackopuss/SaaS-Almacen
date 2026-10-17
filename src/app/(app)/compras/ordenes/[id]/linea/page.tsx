import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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
  getPurchaseOrder,
  listProductsOfSupplier,
  listSuppliersOfProduct,
} from "@/modules/purchasing";
import { getModuleAccess } from "@/platform/billing";
import {
  getProduct,
  getUnit,
  listPresentations,
  listProducts,
} from "@/platform/catalog";

import { addOrderLineAction, updateOrderLineAction } from "../../actions";
import { LineForm } from "./line-form";

export const metadata: Metadata = { title: "Producto de la orden" };

const rowLink =
  "flex min-h-16 items-center gap-3 p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5";

/**
 * A line of a draft (CMP-04): find the product — first among what this
 * supplier sells — then say how it is asked for and how much. The same
 * screen edits a line (`?linea=`). Everything lives in the address.
 */
export default async function LineaPage({
  params,
  searchParams,
}: PageProps<"/compras/ordenes/[id]/linea">) {
  const access = await getModuleAccess();
  const { id } = await params;
  const orderHref = `/compras/ordenes/${id}`;
  const back = (
    <Link
      href={orderHref}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Orden
    </Link>
  );
  if (
    !access.can("purchasing.order.update") ||
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
  const order = await getPurchaseOrder(actor, id);
  if (!order) notFound();
  // Only a draft takes lines.
  if (!order.editable) redirect(`/compras/ordenes/${order.id}`);
  const here = `/compras/ordenes/${order.id}/linea`;
  const withCost = access.allows("purchasing.cost.record");
  const { q, producto, linea } = await searchParams;

  /** «Por pieza», «Caja = 100 piezas»: the ways to ask for a product. */
  const capturesOf = async (productId: string, unitCode: string) => [
    { value: "base", label: `Por ${getUnit(unitCode).name}` },
    ...(access.can("inventory.presentation.read")
      ? (await listPresentations(actor, productId)).map((presentation) => ({
          value: `p:${presentation.id}`,
          label: presentation.label,
        }))
      : []),
  ];

  // Editing a line of the order.
  if (typeof linea === "string" && linea !== "") {
    const line = order.lines.find((item) => item.id === linea);
    if (!line) notFound();
    const product = await getProduct(actor, line.productId);
    if (!product) notFound();
    return (
      <PageContainer>
        {back}
        <PageHeader
          title="Editar producto de la orden"
          description={`${line.productName} (${line.sku}) · ${order.numberText}`}
        />
        <LineForm
          action={updateOrderLineAction.bind(null, order.id, line.id)}
          initial={{
            capture: line.capture,
            quantity: line.capturedQuantity,
            unitCost: line.unitCost ?? "",
          }}
          captures={await capturesOf(product.id, product.unitCode)}
          // Without seeing the cost it cannot be edited: saving would
          // erase a number the person never saw.
          withCost={withCost && order.costsVisible}
          submitLabel="Guardar cambios"
          cancelHref={orderHref}
        />
      </PageContainer>
    );
  }

  // Adding: the product is chosen.
  if (typeof producto === "string" && producto !== "") {
    const product = await getProduct(actor, producto);
    if (!product) notFound();
    // How this supplier sells it, if that is known: the starting point.
    const link = access.can("purchasing.product_supplier.read")
      ? (await listSuppliersOfProduct(actor, product.id)).items.find(
          (item) => item.supplierId === order.supplierId,
        )
      : undefined;
    return (
      <PageContainer>
        {back}
        <PageHeader
          title="Agregar a la orden"
          description={`${product.name} (${product.sku}) · ${order.numberText} · ${order.supplierName}`}
        />
        <LineForm
          action={addOrderLineAction.bind(null, order.id, product.id)}
          initial={{
            capture: link?.presentation ? `p:${link.presentation.id}` : "base",
            quantity: "",
            unitCost: "",
          }}
          captures={await capturesOf(product.id, product.unitCode)}
          withCost={withCost}
          submitLabel="Agregar a la orden"
          cancelHref={here}
        />
        {withCost && link?.lastCost && (
          <p className="max-w-2xl text-sm text-muted-foreground tabular-nums">
            La última vez costó {link.lastCost.text}.
          </p>
        )}
      </PageContainer>
    );
  }

  // Adding: find the product.
  const search = typeof q === "string" ? q : undefined;
  const [sold, list] = await Promise.all([
    !search && access.can("purchasing.product_supplier.read")
      ? listProductsOfSupplier(actor, order.supplierId)
      : null,
    listProducts(actor, { search, pageSize: 10 }),
  ]);
  const known = (sold?.items ?? []).filter((item) => !item.productArchived);
  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Agregar a la orden"
        description={`${order.numberText} · ${order.supplierName}`}
      />
      <Form
        action={here}
        role="search"
        className="flex max-w-3xl flex-wrap items-center gap-2"
      >
        <label htmlFor="q" className="sr-only">
          Buscar el producto que vas a pedir
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

      {known.length > 0 && (
        <section
          aria-labelledby="lo-que-vende"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <h2 id="lo-que-vende" className="border-b p-4 font-medium sm:px-5">
            Lo que te vende {order.supplierName}
          </h2>
          <ul className="divide-y">
            {known.map((item) => (
              <li key={item.id}>
                <Link
                  href={`${here}?producto=${item.productId}`}
                  className={rowLink}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium [overflow-wrap:anywhere]">
                      {item.productName}
                    </span>
                    <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {item.sku}
                      {item.supplierSku &&
                        ` · su código: ${item.supplierSku}`}{" "}
                      · por{" "}
                      {item.presentation
                        ? item.presentation.text
                        : item.unitName}
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
        </section>
      )}

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
              : "Agrega tus productos en Inventario para poder pedirlos."
          }
        />
      ) : (
        <section
          aria-labelledby="elige-producto"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <h2 id="elige-producto" className="border-b p-4 font-medium sm:px-5">
            {list.search ? "Elige el producto" : "Todos tus productos"}
          </h2>
          <ul className="divide-y">
            {list.items.map((product) => (
              <li key={product.id}>
                <Link
                  href={`${here}?producto=${product.id}`}
                  className={rowLink}
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
