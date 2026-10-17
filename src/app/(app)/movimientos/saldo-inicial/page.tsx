import { newId } from "@/lib";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  Package,
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
import {
  formatStock,
  getInitialBalanceState,
  getStockByLocation,
  listProductsWithoutStock,
  listRecentMovements,
  listStockLocations,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";
import { getProduct, listPresentations } from "@/platform/catalog";

import { captureOptions } from "../capture-options";
import { EntryForm } from "../entrada/entry-form";

export const metadata: Metadata = { title: "Saldo inicial" };

const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Guided initial balance (INV-18): the products nobody has moved yet, one
 * after the other. What is captured is recorded as a movement.
 */
export default async function SaldoInicialPage({
  searchParams,
}: PageProps<"/movimientos/saldo-inicial">) {
  const access = await getModuleAccess();
  const back = (
    <Link href="/movimientos" className={linkClass}>
      <ChevronLeft aria-hidden="true" className="size-4" />
      Movimientos
    </Link>
  );
  if (!access.can("inventory.opening.create")) {
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
  const { producto, guardado, pagina } = await searchParams;

  if (typeof producto === "string" && producto !== "") {
    const product = await getProduct(actor, producto);
    const guide = (
      <Link href="/movimientos/saldo-inicial" className={linkClass}>
        <ChevronLeft aria-hidden="true" className="size-4" />
        Productos sin existencias
      </Link>
    );
    if (!product || product.status !== "ACTIVE") {
      return (
        <PageContainer>
          {guide}
          <EmptyState
            icon={Package}
            title={
              product
                ? "Este producto está archivado"
                : "Este producto no existe"
            }
            description={
              product
                ? "Reactívalo en Inventario para capturar su saldo inicial."
                : "Puede que se haya archivado o que la dirección esté incompleta."
            }
          />
        </PageContainer>
      );
    }
    const [state, locations, stock, presentations] = await Promise.all([
      getInitialBalanceState(actor, product.id),
      listStockLocations(actor),
      getStockByLocation(actor, product.id),
      access.can("inventory.presentation.read")
        ? listPresentations(actor, product.id)
        : [],
    ]);
    const pending = locations.filter(
      (location) => !state.capturedLocationIds.includes(location.id),
    );
    const captured = locations.filter((location) => stock[location.id]);
    const header = (
      <PageHeader
        title="Saldo inicial"
        description={`${product.name} · ${product.sku}`}
      />
    );
    if (!state.open || pending.length === 0) {
      return (
        <PageContainer>
          {guide}
          {header}
          <EmptyState
            icon={ClipboardCheck}
            title={
              state.open
                ? "Ya capturaste su saldo inicial en todas tus ubicaciones"
                : "Este producto ya tiene movimientos"
            }
            description={
              state.open
                ? "Lo que llegue de ahora en adelante se registra con una entrada."
                : "Su saldo inicial ya no se captura. Lo que llegue se registra con una entrada; si la cantidad no coincide con lo que hay, se corrige con un ajuste."
            }
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
        {guide}
        {header}
        <p className="max-w-xl text-sm text-muted-foreground">
          Escribe lo que hay hoy de este producto. Queda registrado como su
          primer movimiento y ya no se edita: las diferencias posteriores se
          corrigen con un ajuste.
        </p>
        {captured.length > 0 && (
          <p className="text-sm">
            Ya capturado:{" "}
            {captured
              .map(
                (location) =>
                  `${formatStock(stock[location.id] ?? "0", product.unitCode)} en ${location.path}`,
              )
              .join("; ")}
            .
          </p>
        )}
        <EntryForm
          idempotencyKey={newId()}
          mode="initial"
          productId={product.id}
          captures={captureOptions(product, presentations)}
          locations={pending.map((location) => ({
            id: location.id,
            label: location.path,
          }))}
          defaultLocationId={pending[0]?.id ?? ""}
        />
      </PageContainer>
    );
  }

  const requested =
    typeof pagina === "string" && /^\d{1,6}$/.test(pagina) ? Number(pagina) : 1;
  const [list, saved] = await Promise.all([
    listProductsWithoutStock(actor, { page: requested }),
    // The notice is built from the stored movement, never from the address.
    typeof guardado === "string" && guardado
      ? listRecentMovements(actor, { movementId: guardado.slice(0, 36) })
      : [],
  ]);
  const justSaved = saved[0]?.type === "INITIAL" ? saved[0] : undefined;
  const count = (n: number) => n.toLocaleString("es-MX");
  const pageHref = (page: number) =>
    page > 1
      ? `/movimientos/saldo-inicial?pagina=${page}`
      : "/movimientos/saldo-inicial";

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Saldo inicial"
        description="Captura lo que ya tienes para empezar con existencias reales."
      />
      {justSaved && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <p>
            Saldo inicial guardado:{" "}
            {justSaved.lines.map((line, index) => (
              <span key={index}>
                {index > 0 && "; "}
                <span className="font-medium">{line.quantity}</span> de{" "}
                {line.productName} en {line.location}
              </span>
            ))}
            .{" "}
            {justSaved.lines[0] && (
              <Link
                href={`/movimientos/saldo-inicial?producto=${justSaved.lines[0].productId}`}
                className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                ¿También lo tienes en otra ubicación?
              </Link>
            )}
          </p>
        </div>
      )}
      {list.total === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No hay productos pendientes"
          description="Todos tus productos activos ya tienen movimientos. Lo que llegue de ahora en adelante se registra con una entrada."
        />
      ) : (
        <section
          aria-labelledby="sin-existencias"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="sin-existencias" className="font-medium">
              Productos sin existencias registradas
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {list.total === 1
                ? "1 producto"
                : `${count(list.total)} productos`}
            </p>
          </div>
          <p className="border-b p-4 text-sm text-muted-foreground sm:px-5">
            Elige uno y escribe cuánto hay. Si de alguno no tienes nada, déjalo
            así: no hace falta capturar ceros.
          </p>
          <ul className="divide-y">
            {list.items.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/movimientos/saldo-inicial?producto=${product.id}`}
                  className="flex min-h-16 items-center gap-3 p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{product.name}</span>
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
