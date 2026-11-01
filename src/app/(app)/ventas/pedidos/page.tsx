import { ChevronLeft, ChevronRight, PackageCheck } from "lucide-react";
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
import { formatDateTime } from "@/lib";
import {
  SALES_ORDER_PAGE_SIZE,
  listSalesOrders,
  type SalesOrderStatus,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Pedidos" };

const BADGE: Record<
  SalesOrderStatus,
  "secondary" | "outline" | "success" | "destructive"
> = {
  OPEN: "secondary",
  PARTIAL: "outline",
  FULFILLED: "success",
  CANCELLED: "destructive",
};

/** Orders of the company (COT-05): newest first; each row opens the order. */
export default async function PedidosPage({
  searchParams,
}: PageProps<"/ventas/pedidos">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas/cotizaciones"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Cotizaciones
    </Link>
  );
  if (!access.can("sales.quote.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("sales");
  if (moduleState === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Ventas" />
      </PageContainer>
    );
  }
  const { pagina } = await searchParams;
  const list = await listSalesOrders(
    { organizationId: access.organization.id, userId: access.user.id },
    {
      page:
        typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
          ? Number(pagina)
          : 1,
    },
  );
  const zone = access.organization.timeZone;
  const count = (n: number) => n.toLocaleString("es-MX");
  const first = (list.page - 1) * SALES_ORDER_PAGE_SIZE + 1;
  const last = first + list.items.length - 1;
  const pageHref = (page: number) =>
    page > 1 ? `/ventas/pedidos?pagina=${page}` : "/ventas/pedidos";

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Ventas" />}
      <PageHeader title="Pedidos" />
      {list.items.length === 0 ? (
        <EmptyState
          icon={PackageCheck}
          title="Todavía no hay pedidos"
          description="Un pedido nace de una cotización aceptada."
        />
      ) : (
        <section
          aria-labelledby="lista-pedidos"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="lista-pedidos" className="font-medium">
              Pedidos
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {list.total === 1
                ? "1 pedido"
                : `${count(first)}–${count(last)} de ${count(list.total)} pedidos`}
            </p>
          </div>
          <ul className="divide-y">
            {list.items.map((order) => (
              <li
                key={order.id}
                className="relative flex items-start justify-between gap-3 p-4 hover:bg-muted/40 sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={`/ventas/pedidos/${order.id}`}
                      className="rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Pedido {order.number}
                    </Link>
                    <Badge variant={BADGE[order.status]}>
                      {order.statusLabel}
                    </Badge>
                  </div>
                  <p className="text-sm [overflow-wrap:anywhere]">
                    {order.customer}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    De la cotización {order.quoteNumber} ·{" "}
                    {formatDateTime(order.createdAt, zone)}
                  </p>
                </div>
                <p className="shrink-0 font-medium tabular-nums">
                  {order.total}
                </p>
              </li>
            ))}
          </ul>
          {list.pageCount > 1 && (
            <nav
              aria-label="Páginas de pedidos"
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
