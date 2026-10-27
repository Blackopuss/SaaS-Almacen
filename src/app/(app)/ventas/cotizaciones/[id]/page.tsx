import { ChevronLeft, Pencil } from "lucide-react";
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
import { getQuote } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

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
  const quote = await getQuote(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!quote) notFound();
  const edit =
    quote.status === "DRAFT" && access.allows("sales.quote.create") ? (
      <Button asChild variant="outline">
        <Link href={`/ventas/cotizaciones/${quote.id}/editar`}>
          <Pencil aria-hidden="true" data-icon="inline-start" />
          Editar cotización
        </Link>
      </Button>
    ) : undefined;

  return (
    <PageContainer>
      {back}
      <PageHeader title={`Cotización ${quote.number}`} actions={edit} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section
            aria-label="Datos de la cotización"
            className="space-y-2 rounded-xl border bg-card p-4 text-sm sm:p-5"
          >
            <p className="flex flex-wrap items-center gap-2">
              <Badge
                variant={quote.status === "DRAFT" ? "outline" : "secondary"}
              >
                {quote.statusLabel}
              </Badge>
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
            </p>
            {quote.notes && (
              <p className="[overflow-wrap:anywhere] whitespace-pre-line">
                {quote.notes}
              </p>
            )}
          </section>
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
