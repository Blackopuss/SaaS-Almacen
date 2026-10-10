import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ShoppingCart,
  Truck,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib";
import {
  PURCHASE_ORDER_STATUS_LABELS,
  listPurchaseOrders,
  type PurchaseOrderStatus,
} from "@/modules/purchasing";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Compras" };

const chip =
  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Compras: the purchase orders of the company, newest first (CMP-04),
 * and the way to its suppliers. The state filter and the page live in
 * the address.
 */
export default async function ComprasPage({
  searchParams,
}: PageProps<"/compras">) {
  const access = await getModuleAccess();
  if (!access.can("purchasing.order.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("purchasing");
  if (moduleState === "none") {
    return (
      <PageContainer>
        <NoModuleState module="Compras" />
      </PageContainer>
    );
  }
  const { estado, pagina } = await searchParams;
  const list = await listPurchaseOrders(
    { organizationId: access.organization.id, userId: access.user.id },
    {
      status: typeof estado === "string" ? estado : undefined,
      page:
        typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
          ? Number(pagina)
          : undefined,
    },
  );
  const pageHref = (page: number, status = list.status) => {
    const params = new URLSearchParams();
    if (status) params.set("estado", status);
    if (page > 1) params.set("pagina", String(page));
    const query = params.toString();
    return query ? `/compras?${query}` : "/compras";
  };
  const canCreate =
    moduleState === "active" &&
    access.allows("purchasing.order.create") &&
    access.can("purchasing.supplier.read");
  const newButton = canCreate ? (
    <Button asChild>
      <Link href="/compras/ordenes/nueva">
        <Plus aria-hidden="true" data-icon="inline-start" />
        Nueva orden
      </Link>
    </Button>
  ) : undefined;
  const statuses = Object.keys(
    PURCHASE_ORDER_STATUS_LABELS,
  ) as PurchaseOrderStatus[];

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Compras" />}
      <PageHeader
        title="Compras"
        description="Lo que le pides a tus proveedores."
        actions={newButton}
      />
      {access.can("purchasing.supplier.read") && (
        <Link
          href="/compras/proveedores"
          className="flex min-h-16 max-w-3xl items-center gap-3 rounded-xl border bg-card p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5"
        >
          <Truck
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Proveedores</span>
            <span className="block text-sm text-muted-foreground">
              A quién le compras, y qué te vende cada uno.
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </Link>
      )}

      {(list.total > 0 || list.status) && (
        <nav
          aria-label="Estado de las órdenes"
          className="flex flex-wrap gap-2"
        >
          <Link
            href={pageHref(1, null)}
            aria-current={list.status === null ? "true" : undefined}
            className={`${chip} ${list.status === null ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted"}`}
          >
            Todas
          </Link>
          {statuses.map((status) => (
            <Link
              key={status}
              href={pageHref(1, status)}
              aria-current={list.status === status ? "true" : undefined}
              className={`${chip} ${list.status === status ? "border-primary bg-primary/10 text-primary" : "bg-card hover:bg-muted"}`}
            >
              {PURCHASE_ORDER_STATUS_LABELS[status]}
            </Link>
          ))}
        </nav>
      )}

      {list.total === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={
            list.status
              ? "No hay órdenes en ese estado"
              : "Sin órdenes de compra"
          }
          description={
            list.status
              ? "Elige otro estado o mira todas."
              : "Haz una orden para un proveedor: eliges qué le pides, cuánto y cómo viene."
          }
          action={list.status ? undefined : newButton}
        />
      ) : (
        <section
          aria-label="Órdenes de compra"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <ul className="divide-y">
            {list.items.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/compras/ordenes/${order.id}`}
                  className="flex min-h-16 items-center gap-3 p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium tabular-nums">
                        {order.numberText}
                      </span>
                      <Badge
                        variant={
                          order.status === "DRAFT" ? "secondary" : "default"
                        }
                      >
                        {order.statusLabel}
                      </Badge>
                    </span>
                    <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {order.supplierName} ·{" "}
                      {order.lines === 1
                        ? "1 producto"
                        : `${order.lines} productos`}{" "}
                      ·{" "}
                      <time dateTime={order.createdAt.toISOString()}>
                        {formatDate(
                          order.createdAt,
                          access.organization.timeZone,
                        )}
                      </time>
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
              aria-label="Páginas de órdenes"
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
                Página {list.page} de {list.pageCount}
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
