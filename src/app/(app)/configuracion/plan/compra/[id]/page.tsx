import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { NoAccessState, PageContainer, PageHeader } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib";
import { getAccess } from "@/platform/authorization";
import { formatMxn, getOrder } from "@/platform/billing";

import { ORDER_STATUS } from "../../order-status";

import { CopyButton, PendingRefresh } from "./order-live";

export const metadata: Metadata = { title: "Compra del plan" };

/** Status of one purchase (ADR 0028), where the provider sends people back. */
export default async function OrderPage({
  params,
}: PageProps<"/configuracion/plan/compra/[id]">) {
  const access = await getAccess();
  const back = (
    <Link
      href="/configuracion/plan"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Mi plan
    </Link>
  );
  if (!access.can("platform.subscription.create")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState
          title="Solo el titular ve las compras"
          description="Solo el titular de la empresa compra el plan; tu equipo usa el mismo plan."
        />
      </PageContainer>
    );
  }
  const { id } = await params;
  const order = await getOrder(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!order) notFound();
  const status = ORDER_STATUS[order.status];
  const timeZone = access.organization.timeZone;

  return (
    <PageContainer>
      {back}
      {order.status === "PENDING" && <PendingRefresh />}
      <PageHeader
        title="Compra del plan"
        description={`Iniciada el ${formatDateTime(order.createdAt, timeZone)}`}
      />

      <section
        aria-labelledby="estado"
        className="max-w-2xl space-y-4 rounded-xl border bg-card p-4 sm:p-5"
      >
        <h2 id="estado" className="sr-only">
          Estado
        </h2>
        <div aria-live="polite" className="space-y-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          {order.status === "PAID" && (
            <p className="text-sm">
              Tu plan quedó activo
              {order.validUntil
                ? ` hasta el ${formatDate(order.validUntil, timeZone)}`
                : ""}
              . Te enviamos el comprobante por correo.
            </p>
          )}
          {order.status === "PENDING" && (
            <p className="text-sm text-muted-foreground">
              Estamos esperando que el proveedor confirme tu pago; esta página
              se actualiza sola. Si pagaste en OXXO o por transferencia, la
              confirmación puede tardar algunas horas. Cuando llegue, tu plan se
              activa y te enviamos el comprobante por correo.
            </p>
          )}
          {(order.status === "FAILED" || order.status === "EXPIRED") && (
            <p className="text-sm text-muted-foreground">
              No se te cobró nada por esta compra.
            </p>
          )}
        </div>

        <div className="rounded-lg border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">ID de transacción</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-xl font-semibold tracking-wider">
              {order.transactionId}
            </p>
            <CopyButton text={order.transactionId} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Menciónalo si nos escribes sobre esta compra.
          </p>
        </div>

        <dl className="space-y-2 text-sm tabular-nums">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="text-right">{order.planText}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Meses</dt>
            <dd>{order.months}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{formatMxn(order.subtotal)}</dd>
          </div>
          {order.discount !== "0.00" && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Descuento</dt>
              <dd>−{formatMxn(order.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">IVA 16%</dt>
            <dd>{formatMxn(order.tax)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>{formatMxn(order.total)} MXN</dd>
          </div>
          {order.validUntil && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Vigente hasta</dt>
              <dd>{formatDate(order.validUntil, timeZone)}</dd>
            </div>
          )}
        </dl>

        {(order.status === "FAILED" || order.status === "EXPIRED") && (
          <Button asChild>
            <Link href="/configuracion/plan/comprar">Intentar otra vez</Link>
          </Button>
        )}
      </section>
    </PageContainer>
  );
}
