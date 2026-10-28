import { ChevronLeft } from "lucide-react";
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
import { awaitsFulfillment, getSalesOrder } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { CancelOrderForm } from "./cancel-form";

export const metadata: Metadata = { title: "Cancelar pedido" };

/**
 * Cancelling an order (COT-09): what is missing is no longer delivered;
 * what was delivered stays sold.
 */
export default async function CancelarPedidoPage({
  params,
}: PageProps<"/ventas/pedidos/[id]/cancelar">) {
  const access = await getModuleAccess();
  const { id } = await params;
  const back = (
    <Link
      href={`/ventas/pedidos/${encodeURIComponent(id)}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Pedido
    </Link>
  );
  if (!access.can("sales.sale.cancel") || !access.can("sales.quote.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("sales");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        {back}
        {moduleState === "none" ? (
          <NoModuleState module="Ventas" />
        ) : (
          <ReadOnlyNotice module="Ventas" />
        )}
      </PageContainer>
    );
  }
  const order = await getSalesOrder(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!order) notFound();
  const title = `Cancelar pedido ${order.number}`;
  if (!awaitsFulfillment(order.status)) {
    return (
      <PageContainer>
        {back}
        <PageHeader title={title} />
        <p className="text-sm text-muted-foreground">
          {order.status === "CANCELLED"
            ? "Este pedido ya está cancelado."
            : "Este pedido ya se entregó completo: no queda nada por cancelar. Si el cliente regresa algo, hazlo desde su venta."}
        </p>
      </PageContainer>
    );
  }
  const missing = order.lines.filter((line) => line.missingText);

  return (
    <PageContainer>
      {back}
      <PageHeader title={title} description={order.customer.name} />
      <div className="max-w-xl space-y-2 text-sm">
        <p>Lo que falta ya no se entrega:</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {missing.map((line) => (
            <li key={line.id}>
              {line.missingText} de {line.productName}
            </li>
          ))}
        </ul>
        {order.sales.length > 0 && (
          <p className="text-muted-foreground">
            Lo ya entregado sigue vendido. Si el cliente lo regresa, hazlo desde
            su venta.
          </p>
        )}
      </div>
      <CancelOrderForm orderId={order.id} />
    </PageContainer>
  );
}
