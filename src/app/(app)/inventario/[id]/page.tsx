import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ChevronLeft,
  Pencil,
  Scale,
} from "lucide-react";
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
import { dec, formatDateTime } from "@/lib";
import {
  formatStock,
  getMinimum,
  getProductStock,
  listRecentMovements,
} from "@/modules/inventory";
import { listSuppliersOfProduct } from "@/modules/purchasing";
import { getModuleAccess } from "@/platform/billing";
import { getProduct, getUnit, listPresentations } from "@/platform/catalog";

import { MinimumForm } from "./minimum-form";

export const metadata: Metadata = { title: "Producto" };

/**
 * Card of a product (INV-26): what it is, how much there is in total, in
 * which locations, and what that is in its presentations.
 */
export default async function ProductoPage({
  params,
}: PageProps<"/inventario/[id]">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/inventario"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Inventario
    </Link>
  );
  if (!access.can("inventory.product.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Inventario" />
      </PageContainer>
    );
  }

  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const { id } = await params;
  const product = await getProduct(actor, id);
  if (!product) notFound();
  const active = product.status === "ACTIVE";

  // Who sells it (CMP-03): only with Compras contracted and for who may
  // see that side; the costs come only for who may see costs.
  const showSuppliers =
    access.moduleState("purchasing") !== "none" &&
    access.can("purchasing.product_supplier.read");
  const [stock, presentations, movements, minimum, suppliers] =
    await Promise.all([
      access.can("inventory.stock.read")
        ? getProductStock(actor, product.id)
        : null,
      access.can("inventory.presentation.read")
        ? listPresentations(actor, product.id)
        : [],
      access.can("inventory.movement.read")
        ? listRecentMovements(actor, { productId: product.id, limit: 8 })
        : [],
      access.can("inventory.minimum.read")
        ? getMinimum(actor, product.id)
        : null,
      showSuppliers ? listSuppliersOfProduct(actor, product.id) : null,
    ]);
  // Low = the real balance is at or below the minimum (INV-30).
  const low =
    active &&
    stock !== null &&
    minimum !== null &&
    dec(stock.total).lessThanOrEqualTo(minimum);
  const unit = getUnit(product.unitCode);
  const hasStock = stock !== null && stock.locations.length > 0;

  const action = (
    href: string,
    label: string,
    Icon: typeof Pencil,
    primary = false,
  ) => (
    <Button asChild variant={primary ? "default" : "outline"}>
      <Link href={href}>
        <Icon aria-hidden="true" data-icon="inline-start" />
        {label}
      </Link>
    </Button>
  );
  const actions = active ? (
    <>
      {access.allows("inventory.entry.create") &&
        action(
          `/movimientos/entrada?producto=${product.id}`,
          "Entrada",
          ArrowDownToLine,
          true,
        )}
      {hasStock &&
        access.allows("inventory.exit.create") &&
        action(
          `/movimientos/salida?producto=${product.id}`,
          "Salida",
          ArrowUpFromLine,
        )}
      {hasStock &&
        access.allows("inventory.transfer.create") &&
        action(
          `/movimientos/reubicar?producto=${product.id}`,
          "Reubicar",
          ArrowLeftRight,
        )}
      {access.allows("inventory.adjustment.create") &&
        action(`/movimientos/ajuste?producto=${product.id}`, "Ajustar", Scale)}
      {access.allows("inventory.product.update") &&
        action(`/inventario/${product.id}/editar`, "Editar ficha", Pencil)}
    </>
  ) : undefined;

  const facts: [string, string][] = [
    ["Clave (SKU)", product.sku],
    ["Código de barras", product.barcode ?? "Sin código"],
    ["Categoría", product.category ?? "Sin categoría"],
    ["Marca", product.brand ?? "Sin marca"],
    [
      "Se controla en",
      `${unit.plural}${unit.fractional ? `, en pasos de ${Number(product.quantityStep)}` : ", en enteros"}`,
    ],
  ];

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title={product.name}
        description={product.description ?? undefined}
        actions={actions}
      />
      {!active && (
        <p>
          <Badge variant="secondary">Archivado</Badge>{" "}
          <span className="text-sm text-muted-foreground">
            No aparece en tu catálogo. Reactívalo desde la lista de archivados.
          </span>
        </p>
      )}

      {stock && (
        <section
          aria-labelledby="existencias"
          className="rounded-xl border bg-card"
        >
          <div className="space-y-1 border-b p-4 sm:p-5">
            <h2
              id="existencias"
              className="text-sm font-medium text-muted-foreground"
            >
              Existencias
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-3xl font-semibold tracking-tight tabular-nums">
                {stock.totalLabel}
              </span>
              {low && (
                <Badge
                  variant={
                    stock.locations.length === 0 ? "destructive" : "warning"
                  }
                >
                  {stock.locations.length === 0
                    ? "Agotado"
                    : "Existencias bajas"}
                </Badge>
              )}
            </p>
            {minimum !== null && (
              <p className="text-sm text-muted-foreground">
                Mínimo: {formatStock(minimum, product.unitCode)}
              </p>
            )}
            {stock.equivalences.map((equivalence) => (
              <p
                key={equivalence.presentation}
                className="text-sm text-muted-foreground"
              >
                {equivalence.text}
              </p>
            ))}
            {stock.equivalences.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Es una equivalencia: no indica cuántos empaques cerrados hay.
              </p>
            )}
          </div>
          {stock.locations.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground sm:px-5">
              Todavía no hay existencias en ninguna ubicación.
            </p>
          ) : (
            <>
              <h3 className="px-4 pt-4 text-sm font-medium sm:px-5">
                Dónde está
              </h3>
              <ul className="divide-y">
                {stock.locations.map((location) => (
                  <li
                    key={location.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4 sm:px-5"
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {location.path}
                      {location.archived && (
                        <>
                          {" "}
                          <Badge variant="warning">Ubicación archivada</Badge>
                        </>
                      )}
                    </span>
                    <span className="font-medium tabular-nums">
                      {location.label}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {active &&
        moduleState === "active" &&
        access.allows("inventory.minimum.update") && (
          <section
            aria-label="Mínimo del producto"
            className="rounded-xl border bg-card p-4 sm:p-5"
          >
            <MinimumForm
              productId={product.id}
              minimum={minimum ?? ""}
              unit={unit.plural}
            />
          </section>
        )}

      <section
        aria-labelledby="ficha"
        className="rounded-xl border bg-card p-4 sm:p-5"
      >
        <h2 id="ficha" className="font-medium">
          Ficha
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt className="text-sm text-muted-foreground">{term}</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
          {presentations.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">Presentaciones</dt>
              <dd className="font-medium">
                {presentations.map((p) => p.label).join(" · ")}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {suppliers && suppliers.total > 0 && (
        <section
          aria-labelledby="proveedores-producto"
          className="rounded-xl border bg-card"
        >
          <h2
            id="proveedores-producto"
            className="border-b px-4 py-3 font-medium sm:px-5"
          >
            Quién te lo vende
          </h2>
          <ul className="divide-y">
            {suppliers.items.map((link) => (
              <li key={link.id} className="space-y-1 p-4 sm:px-5">
                <p className="font-medium [overflow-wrap:anywhere]">
                  {access.can("purchasing.supplier.read") ? (
                    <Link
                      href={`/compras/proveedores/${link.supplierId}`}
                      className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {link.supplierName}
                    </Link>
                  ) : (
                    link.supplierName
                  )}
                </p>
                <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                  {link.supplierSku
                    ? `Su código: ${link.supplierSku}`
                    : "Sin código del proveedor"}{" "}
                  · Se compra por{" "}
                  {link.presentation ? link.presentation.text : link.unitName}
                </p>
                {suppliers.costsVisible && link.lastCost && (
                  <p className="text-sm tabular-nums">
                    Último costo: {link.lastCost.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {access.can("inventory.movement.read") && (
        <section
          aria-labelledby="movimientos-producto"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 border-b px-4 py-2 sm:px-5">
            <h2 id="movimientos-producto" className="font-medium">
              Últimos movimientos
            </h2>
            {movements.length > 0 && (
              <Link
                href={`/movimientos?producto=${product.id}`}
                className="inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Ver historial completo
              </Link>
            )}
          </div>
          {movements.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground sm:px-5">
              Este producto todavía no tiene movimientos.
            </p>
          ) : (
            <ul className="divide-y">
              {movements.map((movement) => (
                <li key={movement.id} className="space-y-1 p-4 sm:px-5">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <Badge variant="secondary">{movement.typeLabel}</Badge>
                    {movement.reversedByMovementId && (
                      <Badge variant="outline">Reversado</Badge>
                    )}
                    <time dateTime={movement.createdAt.toISOString()}>
                      {formatDateTime(movement.createdAt)}
                    </time>
                  </p>
                  {movement.lines
                    .filter((line) => line.productId === product.id)
                    .map((line, index) => (
                      <p key={index} className="[overflow-wrap:anywhere]">
                        <span className="font-medium tabular-nums">
                          {line.direction === "IN" ? "+" : "−"}
                          {line.quantity}
                        </span>{" "}
                        {line.captured && (
                          <span className="text-muted-foreground">
                            ({line.captured}){" "}
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          · {line.location}
                        </span>
                      </p>
                    ))}
                  {movement.reason && (
                    <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {movement.reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </PageContainer>
  );
}
