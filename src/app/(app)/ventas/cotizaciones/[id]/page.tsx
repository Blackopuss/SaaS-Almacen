import { ChevronLeft, FileDown, Pencil } from "lucide-react";
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
import { formatDateTime } from "@/lib";
import { getQuote, getQuoteDeliveries } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { QuoteDeliveryPanel } from "./delivery-panel";
import { QuoteStatusActions } from "./status-actions";

export const metadata: Metadata = { title: "Cotización" };

/**
 * A quote (COT-02): to whom, until when, what it offers and what it adds
 * up to. A draft can be changed.
 */
export default async function CotizacionPage({
  params,
}: PageProps<"/ventas/cotizaciones/[id]">) {
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
  const [quote, delivery] = await Promise.all([
    getQuote(actor, id),
    getQuoteDeliveries(actor, id),
  ]);
  if (!quote || !delivery) notFound();
  const zone = access.organization.timeZone;
  const active = access.moduleState("sales") === "active";
  const canAct = active && access.allows("sales.quote.create");
  const edit =
    quote.status === "DRAFT" && canAct ? (
      <>
        <Button asChild variant="outline">
          <Link href={`/ventas/cotizaciones/${quote.id}/editar`}>
            <Pencil aria-hidden="true" data-icon="inline-start" />
            Editar cotización
          </Link>
        </Button>
        <QuoteStatusActions
          quoteId={quote.id}
          number={quote.number}
          status="DRAFT"
          validUntil={quote.validUntil}
        />
      </>
    ) : undefined;
  const badge =
    quote.status === "ACCEPTED"
      ? "success"
      : quote.status === "REJECTED"
        ? "destructive"
        : quote.status === "SENT"
          ? "secondary"
          : "outline";

  return (
    <PageContainer>
      {back}
      <PageHeader title={`Cotización ${quote.number}`} actions={edit} />
      <p className="-mt-2 flex flex-wrap gap-x-6">
        <a
          href={`/api/ventas/cotizaciones/${quote.id}/pdf`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <FileDown aria-hidden="true" className="size-4" />
          Descargar PDF
        </a>
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section
            aria-label="Datos de la cotización"
            className="space-y-2 rounded-xl border bg-card p-4 text-sm sm:p-5"
          >
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant={badge}>{quote.statusLabel}</Badge>
              <span className="text-muted-foreground">
                Vale hasta {quote.validUntil}
              </span>
            </p>
            <p>
              <span className="font-medium">{quote.customer.name}</span>
              {(quote.customer.phone || quote.customer.rfc) && (
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {[quote.customer.phone, quote.customer.rfc]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </p>
            <p className="text-muted-foreground">
              Hecha por {quote.createdBy ?? "alguien que ya no está"} el{" "}
              {quote.createdAtText}
              {quote.sentAtText && ` · enviada el ${quote.sentAtText}`}
            </p>
            {quote.decision && (
              <p>
                {quote.status === "ACCEPTED" ? "Aceptada" : "Rechazada"} el{" "}
                {quote.decision.atText}
                {quote.decision.by && ` (registró ${quote.decision.by})`}
                {quote.decision.rejectReason &&
                  `: ${quote.decision.rejectReason}`}
              </p>
            )}
            {quote.notes && (
              <p className="[overflow-wrap:anywhere] whitespace-pre-line">
                {quote.notes}
              </p>
            )}
          </section>
          {canAct &&
            (quote.status === "SENT" || quote.status === "EXPIRED") && (
              <QuoteStatusActions
                quoteId={quote.id}
                number={quote.number}
                status={quote.status}
                validUntil={quote.validUntil}
              />
            )}
          {(delivery.deliveries.length > 0 ||
            quote.status === "DRAFT" ||
            quote.status === "SENT") && (
            <QuoteDeliveryPanel
              quoteId={quote.id}
              number={quote.number}
              customerName={quote.customer.name}
              draft={quote.status === "DRAFT"}
              inProgress={delivery.inProgress}
              send={active ? delivery.send : undefined}
              canWriteEmail={access.allows("sales.customer.create")}
              deliveries={delivery.deliveries.map((row) => ({
                id: row.id,
                recipient: row.recipient,
                status: row.status,
                statusLabel: row.statusLabel,
                requestedText: formatDateTime(row.requestedAt, zone),
                endedText: row.sentAt ? formatDateTime(row.sentAt, zone) : null,
                failureReason: row.failureReason,
                attempts: row.attempts,
                maxAttempts: row.maxAttempts,
                retrying: row.retrying,
              }))}
            />
          )}
          <section
            aria-labelledby="productos-cotizados"
            className="rounded-xl border bg-card"
          >
            <h2
              id="productos-cotizados"
              className="border-b p-4 font-medium sm:px-5"
            >
              Productos
            </h2>
            <ul className="divide-y">
              {quote.lines.map((line) => (
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
                  </p>
                  <p className="shrink-0 font-medium tabular-nums">
                    {line.amount}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section
          aria-labelledby="total-cotizado"
          className="space-y-2 rounded-xl border bg-card p-4 sm:p-5"
        >
          <h2 id="total-cotizado" className="font-medium">
            Total
          </h2>
          <dl className="space-y-1 text-sm tabular-nums">
            {quote.discount && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">
                  Descuento · {quote.discount.reason}
                </dt>
                <dd>{quote.discount.text}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{quote.subtotal}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{quote.taxLabel}</dt>
              <dd>{quote.tax}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t pt-2">
              <dt className="font-medium">Total</dt>
              <dd className="text-2xl font-semibold">{quote.total}</dd>
            </div>
          </dl>
        </section>
      </div>
    </PageContainer>
  );
}
