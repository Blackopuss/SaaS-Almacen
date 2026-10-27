import { ChevronLeft, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  QrCode,
} from "@/components";
import { getReturnableSale, getSaleTicket } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { PrintButton } from "../../../ticket/print-button";
import { TicketView } from "../../../ticket/ticket-view";
import { CopyLink } from "./copy-link";

export const metadata: Metadata = { title: "Ticket de venta" };

/**
 * A sale's ticket (VEN-15): print it at 80 mm, or give the customer its
 * link — a QR to scan or the address to send.
 */
/** What to give back, said once the return is registered. */
function given(refund: string, method: string) {
  if (method === "CASH") return `Entrega ${refund} en efectivo al cliente.`;
  if (method === "CARD") return `Se devolvieron ${refund} a la tarjeta.`;
  return `Se devolvieron ${refund} por transferencia.`;
}

export default async function VentaPage({
  params,
  searchParams,
}: PageProps<"/ventas/[id]">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 print:hidden"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Ventas
    </Link>
  );
  if (!access.can("sales.sale.read")) {
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
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const [ticket, returnable] = await Promise.all([
    getSaleTicket(actor, id),
    getReturnableSale(actor, id),
  ]);
  if (!ticket || !returnable) notFound();
  const asked = (await searchParams).devolucion;
  const registered = returnable.returns.find((r) => r.id === asked);
  const somethingLeft =
    !returnable.cancelled &&
    returnable.lines.some((line) => line.returnable !== "0");
  const occasional = somethingLeft
    ? [
        access.allows("sales.return.create") && {
          href: `/ventas/${ticket.saleId}/devolver`,
          label: "Devolver productos",
        },
        access.allows("sales.sale.cancel") && {
          href: `/ventas/${ticket.saleId}/cancelar`,
          label: "Cancelar venta",
        },
      ].filter((item) => item !== false)
    : [];
  const link = `${(process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "")}${ticket.publicPath}`;

  return (
    <PageContainer>
      {back}
      <div className="space-y-2 print:hidden">
        <PageHeader title={`Venta ${ticket.number}`} />
        {registered && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 p-4 text-sm"
          >
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-success"
            />
            <p>
              <span className="font-medium">
                {registered.cancelsSale
                  ? "Venta cancelada."
                  : "Devolución registrada."}
              </span>{" "}
              {given(registered.refund, registered.refundMethod)} Lo que regresó
              ya está en el inventario.
            </p>
          </div>
        )}
        {returnable.refunded !== "$0.00" && (
          <p className="text-sm text-muted-foreground">
            Se devolvieron {returnable.refunded} de {returnable.total}.
          </p>
        )}
        {occasional.length > 0 && (
          <p className="flex flex-wrap gap-x-6">
            {occasional.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {label}
              </Link>
            ))}
          </p>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,24rem)_1fr] md:items-start print:block">
        <TicketView ticket={ticket} />
        <section
          aria-labelledby="ticket-cliente"
          className="space-y-4 rounded-xl border bg-card p-4 sm:p-5 print:hidden"
        >
          <PrintButton variant="default" />
          <h2 id="ticket-cliente" className="font-medium">
            Ticket para el cliente
          </h2>
          <p className="text-sm text-muted-foreground">
            Que lo escanee con su celular, o mándale el enlace.
          </p>
          <QrCode
            value={link}
            label={`Código QR del ticket de la venta ${ticket.number}`}
            className="size-44 rounded-lg"
          />
          <CopyLink link={link} />
          {access.allows("sales.sale.create") && (
            <Link
              href="/ventas"
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Nueva venta
            </Link>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
