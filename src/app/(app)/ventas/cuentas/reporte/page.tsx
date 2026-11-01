import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPortfolioReport } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Reporte de cartera" };

const quietLink =
  "inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

const accounts = (n: number) => (n === 1 ? "1 cuenta" : `${n} cuentas`);

/**
 * Report of the portfolio (PAG-09): what is owed and overdue today, and
 * what was sold on installments and collected in a period. The dates live
 * in the address; by default, this month.
 */
export default async function ReporteCarteraPage({
  searchParams,
}: PageProps<"/ventas/cuentas/reporte">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas/cuentas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Cuentas por cobrar
    </Link>
  );
  if (
    !access.can("sales.report.read") ||
    !access.can("sales.receivable.read")
  ) {
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
  const report = await getPortfolioReport(
    { organizationId: access.organization.id, userId: access.user.id },
    { from: day(desde), to: day(hasta) },
  );

  const form = (
    <Form
      action="/ventas/cuentas/reporte"
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
        <PageHeader title="Reporte de cartera" />
        {form}
        <p role="alert" className="text-sm text-destructive">
          {report.error}
        </p>
      </PageContainer>
    );
  }

  const row = (label: ReactNode, value: ReactNode) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 p-4 text-sm sm:px-5">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );

  return (
    <PageContainer>
      {back}
      <PageHeader title="Reporte de cartera" />
      <section
        aria-label="Por cobrar hoy"
        className="max-w-4xl space-y-1 rounded-xl border bg-card p-4 sm:p-5"
      >
        <p className="text-sm text-muted-foreground">
          Por cobrar hoy · {accounts(report.openAccounts)}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{report.owed}</p>
        <p className="text-sm tabular-nums">
          {report.overdueAccounts === 0 ? (
            "Nadie está atrasado."
          ) : (
            <Link href="/ventas/cuentas?vencidas=1" className={quietLink}>
              Vencido {report.overdue} en {accounts(report.overdueAccounts)}
            </Link>
          )}
        </p>
      </section>
      {form}
      <section
        aria-labelledby="vendido-plazos"
        className="max-w-4xl rounded-xl border bg-card"
      >
        <h2 id="vendido-plazos" className="border-b p-4 font-medium sm:px-5">
          Vendido a plazos del {report.from} al {report.to}
        </h2>
        <dl className="divide-y">
          {row(
            report.sold.count === 1 ? "1 venta" : `${report.sold.count} ventas`,
            <span className="font-medium">{report.sold.total}</span>,
          )}
          {row("Enganches", report.sold.downPayments)}
          {row("Interés pactado", report.sold.interest)}
        </dl>
      </section>
      <section
        aria-labelledby="cobrado"
        className="max-w-4xl rounded-xl border bg-card"
      >
        <h2 id="cobrado" className="border-b p-4 font-medium sm:px-5">
          Cobrado en abonos
        </h2>
        <dl className="divide-y">
          {row(
            report.collected.count === 1
              ? "1 abono"
              : `${report.collected.count} abonos`,
            <span className="font-medium">{report.collected.total}</span>,
          )}
          {row("Efectivo", report.collected.cash)}
          {row("Tarjeta", report.collected.card)}
          {row("Transferencia", report.collected.transfer)}
          {report.credited !== "$0.00" &&
            row("Descontado por devoluciones", report.credited)}
        </dl>
      </section>
    </PageContainer>
  );
}
