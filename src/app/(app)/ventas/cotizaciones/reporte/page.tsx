import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getQuoteReport, type QuoteTally } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Reporte de cotizaciones" };

const quietLink =
  "inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

const quotes = (n: number) => (n === 1 ? "1 cotización" : `${n} cotizaciones`);

/**
 * Report of quotes (COT-11): how many of a period became sales and what
 * is pending today. The dates live in the address; by default, this month.
 */
export default async function ReporteCotizacionesPage({
  searchParams,
}: PageProps<"/ventas/cotizaciones/reporte">) {
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
  if (!access.can("sales.report.read") || !access.can("sales.quote.read")) {
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
  const { desde, hasta } = await searchParams;
  const day = (value: unknown) =>
    typeof value === "string" ? value.slice(0, 10) : undefined;
  const report = await getQuoteReport(
    { organizationId: access.organization.id, userId: access.user.id },
    { from: day(desde), to: day(hasta) },
  );

  const form = (
    <Form
      action="/ventas/cotizaciones/reporte"
      className="flex max-w-4xl flex-wrap items-end gap-3"
    >
      <div className="space-y-1">
        <label htmlFor="desde" className="text-sm font-medium">
          Desde
        </label>
        <Input
          id="desde"
          name="desde"
          type="date"
          defaultValue={report.ok ? report.from : day(desde)}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="hasta" className="text-sm font-medium">
          Hasta
        </label>
        <Input
          id="hasta"
          name="hasta"
          type="date"
          defaultValue={report.ok ? report.to : day(hasta)}
        />
      </div>
      <Button type="submit" variant="outline">
        Ver
      </Button>
    </Form>
  );

  if (!report.ok) {
    return (
      <PageContainer>
        {back}
        <PageHeader title="Reporte de cotizaciones" />
        {form}
        <p role="alert" className="text-sm text-destructive">
          {report.error}
        </p>
      </PageContainer>
    );
  }

  const rows: [string, QuoteTally][] = [
    ["Aceptadas", report.accepted],
    ["Esperando respuesta", report.waiting],
    ["Rechazadas", report.rejected],
    ["Vencidas sin respuesta", report.expired],
    ["Borradores sin enviar", report.drafts],
  ];

  return (
    <PageContainer>
      {back}
      <PageHeader title="Reporte de cotizaciones" />
      {form}
      <section
        aria-label="Conversión del periodo"
        className="max-w-4xl space-y-1 rounded-xl border bg-card p-4 sm:p-5"
      >
        <p className="text-sm text-muted-foreground">
          Del {report.from} al {report.to} · {quotes(report.made.count)} por{" "}
          {report.made.total}
        </p>
        {report.conversion ? (
          <>
            <p className="text-2xl font-semibold tabular-nums">
              {report.conversion} se aceptó
            </p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {report.accepted.count} de {report.sent.count}{" "}
              {report.sent.count === 1 ? "enviada" : "enviadas"} ·{" "}
              {report.conversionByAmount} del importe ({report.accepted.total}{" "}
              de {report.sent.total})
            </p>
          </>
        ) : (
          <p className="text-sm">
            No se envió ninguna cotización en esas fechas.
          </p>
        )}
        {report.truncated && (
          <p className="text-sm font-medium">
            Son muchas cotizaciones: los totales solo cuentan las primeras.
            Elige un periodo más corto.
          </p>
        )}
      </section>
      <section
        aria-labelledby="como-terminaron"
        className="max-w-4xl rounded-xl border bg-card"
      >
        <h2 id="como-terminaron" className="border-b p-4 font-medium sm:px-5">
          Cómo terminaron
        </h2>
        <dl className="divide-y">
          {rows.map(([label, tally]) => (
            <div
              key={label}
              className="flex flex-wrap items-baseline justify-between gap-x-4 p-4 text-sm sm:px-5"
            >
              <dt>{label}</dt>
              <dd className="tabular-nums">
                {quotes(tally.count)} ·{" "}
                <span className="font-medium">{tally.total}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section
        aria-labelledby="pendiente-hoy"
        className="max-w-4xl rounded-xl border bg-card"
      >
        <h2 id="pendiente-hoy" className="border-b p-4 font-medium sm:px-5">
          Pendiente hoy
        </h2>
        <dl className="divide-y">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 p-4 text-sm sm:px-5">
            <dt>
              <Link href="/ventas/cotizaciones" className={quietLink}>
                Cotizaciones esperando respuesta
              </Link>
            </dt>
            <dd className="tabular-nums">
              {quotes(report.pendingQuotes.count)} ·{" "}
              <span className="font-medium">{report.pendingQuotes.total}</span>
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 p-4 text-sm sm:px-5">
            <dt>
              <Link href="/ventas/pedidos" className={quietLink}>
                Pedidos por entregar
              </Link>
            </dt>
            <dd className="tabular-nums">
              {report.pendingOrders.count === 1
                ? "1 pedido"
                : `${report.pendingOrders.count} pedidos`}{" "}
              · falta entregar{" "}
              <span className="font-medium">{report.pendingOrders.total}</span>
            </dd>
          </div>
        </dl>
      </section>
    </PageContainer>
  );
}
