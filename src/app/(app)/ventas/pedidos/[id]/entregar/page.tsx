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
import { newId } from "@/lib";
import {
  SALE_MAX_PAYMENTS,
  getMyCashSession,
  getOrderToFulfill,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { OpenCashForm } from "../../../caja/cash-forms";
import { FulfillForm } from "./fulfill-form";

export const metadata: Metadata = { title: "Entregar y cobrar" };

/**
 * Delivering an order (COT-08): what goes now, from where, and how it is
 * paid. Each delivery is a sale of the order at its agreed prices.
 */
export default async function EntregarPedidoPage({
  params,
}: PageProps<"/ventas/pedidos/[id]/entregar">) {
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
  if (!access.can("sales.sale.create")) {
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
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const order = await getOrderToFulfill(actor, id);
  if (!order) notFound();
  const title = `Entregar y cobrar · Pedido ${order.number}`;
  if (order.closed) {
    return (
      <PageContainer>
        {back}
        <PageHeader title={title} />
        <p className="text-sm text-muted-foreground">{order.closed}</p>
      </PageContainer>
    );
  }
  // VEN-16: nobody charges without their register open.
  const cash = access.allows("sales.cash.operate")
    ? await getMyCashSession(actor)
    : null;

  return (
    <PageContainer>
      {back}
      <PageHeader title={title} description={order.customerName} />
      {cash ? (
        <FulfillForm
          orderId={order.id}
          lines={order.lines}
          idempotencyKey={newId()}
          maxPayments={SALE_MAX_PAYMENTS}
        />
      ) : access.allows("sales.cash.operate") ? (
        <OpenCashForm />
      ) : (
        <p className="text-sm text-muted-foreground">
          Para cobrar se necesita una caja abierta, y tu rol no abre caja.
        </p>
      )}
    </PageContainer>
  );
}
