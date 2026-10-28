import { ChevronLeft, HandCoins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { awaitsFulfillment, getSalesOrder } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Pedido" };

const quietLink =
  "inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * An order (COT-05): for whom, what was agreed and what it adds up to, as
 * its quote said when it was accepted.
 */
export default async function PedidoPage({
  params,
}: PageProps<"/ventas/pedidos/[id]">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas/pedidos"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Pedidos
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
  if (access.moduleState("sales") === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Ventas" />
      </PageContainer>
    );
  }
  const { id } = await params;
  const order = await getSalesOrder(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!order) notFound();
  const canDeliver =
    access.allows("sales.sale.create") &&
    access.moduleState("sales") === "active" &&
    awaitsFulfillment(order.status);
  const canCancel =
    access.allows("sales.sale.cancel") &&
    access.moduleState("sales") === "active" &&
    awaitsFulfillment(order.status);

  return (
    <PageContainer>
      {back}
      <PageHeader
        title={`Pedido ${order.number}`}
        actions={
          canDeliver ? (
            <Button asChild>
              <Link href={`/ventas/pedidos/${order.id}/entregar`}>
                <HandCoins aria-hidden="true" data-icon="inline-start" />
                Entregar y cobrar
              </Link>
            </Button>
          ) : undefined
        }
      />
      <p className="-mt-2 flex flex-wrap gap-x-6">
        <Link
          href={`/ventas/cotizaciones/${order.quote.id}`}
          className={quietLink}
        >
          Cotización {order.quote.number}
        </Link>
        {canCancel && (
          <Link
            href={`/ventas/pedidos/${order.id}/cancelar`}
            className={quietLink}
          >
            Cancelar pedido
          </Link>
        )}
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section
            aria-label="Datos del pedido"
            className="space-y-2 rounded-xl border bg-card p-4 text-sm sm:p-5"
          >
            <p>
              <Badge variant="secondary">{order.statusLabel}</Badge>
            </p>
            <p>
              <span className="font-medium">{order.customer.name}</span>
              {(order.customer.phone || order.customer.rfc) && (
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {[order.customer.phone, order.customer.rfc]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </p>
            <p className="text-muted-foreground">
              Hecho por {order.createdBy ?? "alguien que ya no está"} el{" "}
              {order.createdAtText}
            </p>
            {order.cancellation && (
              <p>
                Cancelado por{" "}
                {order.cancellation.by ?? "alguien que ya no está"} el{" "}
                {order.cancellation.atText} ·{" "}
                <span className="[overflow-wrap:anywhere]">
                  Motivo: {order.cancellation.reason}
                </span>
              </p>
            )}
            {order.notes && (
              <p className="[overflow-wrap:anywhere] whitespace-pre-line">
                {order.notes}
              </p>
            )}
          </section>
          <section
            aria-labelledby="productos-pedido"
            className="rounded-xl border bg-card"
          >
            <h2
              id="productos-pedido"
              className="border-b p-4 font-medium sm:px-5"
            >
              Productos
            </h2>
            <ul className="divide-y">
              {order.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-start justify-between gap-3 p-4 text-sm sm:px-5"
                >
                  <p className="min-w-0">
                    <span className="block font-medium [overflow-wrap:anywhere]">
                      {line.productName}
                    </span>
                    <span className="block text-muted-foreground">
                      {line.quantityText} × {line.unitPrice}
                    </span>
                    {line.deliveredText && (
                      <span className="block text-muted-foreground">
                        Entregado: {line.deliveredText}
                        {line.missingText &&
                          !order.cancellation &&
                          ` · Falta: ${line.missingText}`}
                      </span>
                    )}
                  </p>
                  <p className="shrink-0 font-medium tabular-nums">
                    {line.amount}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          {order.sales.length > 0 && (
            <section
              aria-labelledby="entregas-pedido"
              className="rounded-xl border bg-card"
            >
              <h2
                id="entregas-pedido"
                className="border-b p-4 font-medium sm:px-5"
              >
                Entregas
              </h2>
              <ul className="divide-y">
                {order.sales.map((sale) => (
                  <li
                    key={sale.id}
                    className="relative flex items-start justify-between gap-3 p-4 text-sm hover:bg-muted/40 sm:px-5"
                  >
                    <p className="min-w-0">
                      <Link
                        href={`/ventas/${sale.id}`}
                        className="rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        Venta {sale.number}
                      </Link>
                      {sale.cancelled && (
                        <Badge variant="destructive" className="ml-2">
                          Cancelada
                        </Badge>
                      )}
                      <span className="block text-muted-foreground">
                        {sale.createdAtText}
                      </span>
                    </p>
                    <p className="shrink-0 font-medium tabular-nums">
                      {sale.total}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <section
          aria-labelledby="total-pedido"
          className="space-y-2 rounded-xl border bg-card p-4 sm:p-5"
        >
          <h2 id="total-pedido" className="font-medium">
            Total
          </h2>
          <dl className="space-y-1 text-sm tabular-nums">
            {order.discount && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  Descuento · {order.discount.reason}
                </dt>
                <dd>{order.discount.text}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{order.subtotal}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{order.taxLabel}</dt>
              <dd>{order.tax}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t pt-2">
              <dt className="font-medium">Total</dt>
              <dd className="text-2xl font-semibold">{order.total}</dd>
            </div>
          </dl>
        </section>
      </div>
    </PageContainer>
  );
}
