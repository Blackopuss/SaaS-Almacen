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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { getPendingReport, getPurchasesBySupplier } from "@/modules/purchasing";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Reportes de compras" };

const chip =
  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const textLink =
  "rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Reports of Compras (CMP-15): what is still to be received and what was
 * bought from each supplier in a period. The view and the dates live in
 * the address; amounts appear only for who may see costs.
 */
export default async function ReportesComprasPage({
  searchParams,
}: PageProps<"/compras/reportes">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/compras"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Compras
    </Link>
  );
  if (!access.can("purchasing.report.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  if (access.moduleState("purchasing") === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Compras" />
      </PageContainer>
    );
  }
  const { vista, desde, hasta } = await searchParams;
  const view = vista === "proveedores" ? "proveedores" : "pendientes";
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const canExport = access.can("purchasing.report.export");
  const canOpenOrders = access.can("purchasing.order.read");

  const download = (kind: string, extra: Record<string, string> = {}) =>
    canExport ? (
      <form
        method="get"
        action={`/api/compras/reportes/${kind}`}
        className="flex flex-wrap items-center gap-2"
      >
        {Object.entries(extra).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label htmlFor={`formato-${kind}`} className="sr-only">
          Formato
        </label>
        <div className="w-32">
          <NativeSelect
            id={`formato-${kind}`}
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
    ) : null;

  return (
    <PageContainer>
      {back}
      <PageHeader title="Reportes de compras" />
      <nav aria-label="Reporte" className="flex flex-wrap gap-2">
        {(
          [
            ["pendientes", "Pendientes por recibir"],
            ["proveedores", "Compras por proveedor"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={
              id === "pendientes"
                ? "/compras/reportes"
                : "/compras/reportes?vista=proveedores"
            }
            aria-current={view === id ? "page" : undefined}
            className={`${chip} ${view === id ? "border-primary bg-accent text-accent-foreground" : "bg-card hover:bg-muted"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {view === "pendientes" ? (
        <PendingView
          actor={actor}
          canOpenOrders={canOpenOrders}
          download={download("pendientes")}
        />
      ) : (
        <SupplierView
          actor={actor}
          from={typeof desde === "string" ? desde.slice(0, 10) : undefined}
          to={typeof hasta === "string" ? hasta.slice(0, 10) : undefined}
          download={download}
        />
      )}
    </PageContainer>
  );
}

async function PendingView({
  actor,
  canOpenOrders,
  download,
}: {
  actor: { organizationId: string; userId: string };
  canOpenOrders: boolean;
  download: React.ReactNode;
}) {
  const report = await getPendingReport(actor);
  if (report.rows.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No hay nada por recibir"
        description="Ninguna orden enviada espera mercancía."
      />
    );
  }
  return (
    <section
      aria-labelledby="pendientes"
      className="max-w-4xl rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
        <h2 id="pendientes" className="font-medium">
          {report.orders === 1 ? "1 orden" : `${report.orders} órdenes`} ·{" "}
          {report.rows.length === 1
            ? "1 producto"
            : `${report.rows.length} productos`}
          {report.totalText && (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {report.totalText} por recibir
            </span>
          )}
        </h2>
        {download}
      </div>
      {report.truncated && (
        <p className="border-b px-4 py-3 text-sm text-muted-foreground sm:px-5">
          Son muchas líneas: se muestran las primeras.
        </p>
      )}
      <ul className="divide-y">
        {report.rows.map((row, index) => (
          <li
            key={`${row.orderId}-${index}`}
            className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4 sm:px-5"
          >
            <div className="min-w-0 space-y-1">
              <p className="font-medium [overflow-wrap:anywhere]">
                {row.productName}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {row.sku}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {canOpenOrders ? (
                  <Link
                    href={`/compras/ordenes/${row.orderId}`}
                    className={textLink}
                  >
                    {row.numberText}
                  </Link>
                ) : (
                  row.numberText
                )}{" "}
                · {row.supplierName}
                {row.expectedOn && ` · se espera ${row.expectedOn}`}{" "}
                {row.late && <Badge variant="outline">Atrasada</Badge>}
              </p>
            </div>
            <div className="text-sm tabular-nums sm:text-right">
              <p className="font-medium">Faltan {row.pendingText}</p>
              <p className="text-muted-foreground">
                {row.receivedText
                  ? `llegaron ${row.receivedText} de ${row.orderedText}`
                  : `pediste ${row.orderedText}`}
              </p>
              {row.pendingAmountText && (
                <p className="text-muted-foreground">{row.pendingAmountText}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function SupplierView({
  actor,
  from,
  to,
  download,
}: {
  actor: { organizationId: string; userId: string };
  from?: string;
  to?: string;
  download: (kind: string, extra?: Record<string, string>) => React.ReactNode;
}) {
  const report = await getPurchasesBySupplier(actor, { from, to });
  const form = (
    <Form
      action="/compras/reportes"
      className="flex max-w-4xl flex-wrap items-end gap-3"
    >
      <input type="hidden" name="vista" value="proveedores" />
      <div className="space-y-1">
        <label htmlFor="desde" className="text-sm font-medium">
          Desde
        </label>
        <Input
          id="desde"
          name="desde"
          type="date"
          defaultValue={report.ok ? report.from : from}
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
          defaultValue={report.ok ? report.to : to}
        />
      </div>
      <Button type="submit" variant="outline">
        Ver
      </Button>
    </Form>
  );
  if (!report.ok) {
    return (
      <>
        {form}
        <p role="alert" className="text-sm text-destructive">
          {report.error}
        </p>
      </>
    );
  }
  return (
    <>
      {form}
      {report.rows.length === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="Sin compras en esas fechas"
          description="No se recibió ni se devolvió nada entre esos días."
        />
      ) : (
        <section
          aria-labelledby="por-proveedor"
          className="max-w-4xl rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
            <h2 id="por-proveedor" className="font-medium">
              Del {report.from} al {report.to}
              {report.totalText && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {report.totalText} neto
                </span>
              )}
            </h2>
            {download("proveedores", { desde: report.from, hasta: report.to })}
          </div>
          {report.truncated && (
            <p className="border-b px-4 py-3 text-sm text-muted-foreground sm:px-5">
              Son muchas recepciones: los totales solo cuentan las primeras.
              Elige un periodo más corto.
            </p>
          )}
          <ul className="divide-y">
            {report.rows.map((row) => (
              <li
                key={row.supplierId}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4 sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {row.supplierName}
                  </p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {row.receipts === 1
                      ? "1 recepción"
                      : `${row.receipts} recepciones`}{" "}
                    de {row.orders === 1 ? "1 orden" : `${row.orders} órdenes`}{" "}
                    ·{" "}
                    {row.products === 1
                      ? "1 producto"
                      : `${row.products} productos`}
                    {row.returns > 0 &&
                      ` · ${row.returns === 1 ? "1 devolución" : `${row.returns} devoluciones`}`}
                  </p>
                </div>
                {row.netAmountText && (
                  <div className="text-sm tabular-nums sm:text-right">
                    <p className="font-medium">{row.netAmountText}</p>
                    {row.returnedAmountText &&
                      row.returnedAmountText !== "$0.00" && (
                        <p className="text-muted-foreground">
                          {row.receivedAmountText} − {row.returnedAmountText}{" "}
                          devuelto
                        </p>
                      )}
                    {(row.linesWithoutCost ?? 0) > 0 && (
                      <p className="text-muted-foreground">
                        {row.linesWithoutCost === 1
                          ? "1 producto sin costo"
                          : `${row.linesWithoutCost} productos sin costo`}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
