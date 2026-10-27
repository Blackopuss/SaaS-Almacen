import { ChevronLeft, Download, FileBarChart } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { getSalesReport, type SalesReportRow } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Reportes de ventas" };

const chip =
  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

const VIEWS = [
  ["dias", "Por día"],
  ["productos", "Por producto"],
  ["cajeros", "Por quién cobró"],
] as const;
type View = (typeof VIEWS)[number][0];

/**
 * Reports of Ventas (VEN-23): what was sold in a period by day, product
 * and who charged. The view and the dates live in the address; the profit
 * appears only for who may see inventory costs.
 */
export default async function ReportesVentasPage({
  searchParams,
}: PageProps<"/ventas/reportes">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Ventas
    </Link>
  );
  if (!access.can("sales.report.read")) {
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
  const { vista, desde, hasta } = await searchParams;
  const view: View = VIEWS.some(([id]) => id === vista)
    ? (vista as View)
    : "dias";
  const day = (value: unknown) =>
    typeof value === "string" ? value.slice(0, 10) : undefined;
  const report = await getSalesReport(
    { organizationId: access.organization.id, userId: access.user.id },
    { from: day(desde), to: day(hasta) },
  );
  const range: Record<string, string> = report.ok
    ? { desde: report.from, hasta: report.to }
    : {};
  const hrefOf = (id: View) => {
    const params = new URLSearchParams(range);
    if (id !== "dias") params.set("vista", id);
    return `/ventas/reportes?${params.toString()}`;
  };

  const form = (
    <Form
      action="/ventas/reportes"
      className="flex max-w-4xl flex-wrap items-end gap-3"
    >
      {view !== "dias" && <input type="hidden" name="vista" value={view} />}
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
        <PageHeader title="Reportes de ventas" />
        {form}
        <p role="alert" className="text-sm text-destructive">
          {report.error}
        </p>
      </PageContainer>
    );
  }

  const rows: (SalesReportRow & { detail?: string; costUnknown?: true })[] =
    view === "productos"
      ? report.byProduct.map((row) => ({
          ...row,
          detail: `${row.sku} · ${row.quantity}`,
        }))
      : view === "cajeros"
        ? report.byCashier
        : report.byDay;

  return (
    <PageContainer>
      {back}
      <PageHeader title="Reportes de ventas" />
      {form}
      {report.sales === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="Sin ventas en esas fechas"
          description="No se cobró nada entre esos días."
        />
      ) : (
        <>
          <section
            aria-label="Resumen del periodo"
            className="max-w-4xl space-y-1 rounded-xl border bg-card p-4 sm:p-5"
          >
            <p className="text-sm text-muted-foreground">
              Del {report.from} al {report.to} ·{" "}
              {report.sales === 1 ? "1 venta" : `${report.sales} ventas`}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              {report.total.text}
            </p>
            {report.profit && (
              <p className="text-sm tabular-nums">
                Ganancia antes de IVA:{" "}
                <span className="font-medium">{report.profit.text}</span>
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Sin las ventas canceladas y con las devoluciones descontadas.
              {report.linesWithoutCost
                ? ` ${report.linesWithoutCost === 1 ? "Una línea sin costo conocido no cuenta" : `${report.linesWithoutCost} líneas sin costo conocido no cuentan`} en la ganancia.`
                : ""}
            </p>
            {report.truncated && (
              <p className="text-sm font-medium">
                Son muchas ventas: los totales solo cuentan las primeras. Elige
                un periodo más corto.
              </p>
            )}
          </section>
          <nav aria-label="Reporte" className="flex flex-wrap gap-2">
            {VIEWS.map(([id, label]) => (
              <Link
                key={id}
                href={hrefOf(id)}
                aria-current={view === id ? "page" : undefined}
                className={`${chip} ${view === id ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-muted"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <section
            aria-labelledby="reporte"
            className="max-w-4xl rounded-xl border bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
              <h2 id="reporte" className="font-medium">
                {VIEWS.find(([id]) => id === view)![1]}
              </h2>
              {access.can("sales.report.export") && (
                <form
                  method="get"
                  action={`/api/ventas/reportes/${view}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="desde" value={report.from} />
                  <input type="hidden" name="hasta" value={report.to} />
                  <label htmlFor="formato" className="sr-only">
                    Formato
                  </label>
                  <div className="w-32">
                    <NativeSelect
                      id="formato"
                      name="formato"
                      defaultValue="xlsx"
                    >
                      <option value="xlsx">Excel</option>
                      <option value="csv">CSV</option>
                    </NativeSelect>
                  </div>
                  <Button type="submit" variant="outline">
                    <Download aria-hidden="true" data-icon="inline-start" />
                    Descargar
                  </Button>
                </form>
              )}
            </div>
            <ul className="divide-y">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4 sm:px-5"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {row.label}
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {row.detail && `${row.detail} · `}
                      {row.sales === 1 ? "1 venta" : `${row.sales} ventas`}
                    </p>
                  </div>
                  <div className="text-sm tabular-nums sm:text-right">
                    <p className="font-medium">{row.total.text}</p>
                    {row.profit ? (
                      <p className="text-muted-foreground">
                        Ganancia {row.profit.text}
                      </p>
                    ) : (
                      row.costUnknown && (
                        <p className="text-muted-foreground">
                          Sin costo conocido
                        </p>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </PageContainer>
  );
}
