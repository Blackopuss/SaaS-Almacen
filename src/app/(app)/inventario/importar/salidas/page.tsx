import {
  CalendarCheck,
  ChevronLeft,
  CircleAlert,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib";
import {
  EXIT_IMPORT_STATUS_LABELS,
  formatExitDay,
  getExitCoverage,
  listExitImports,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { ExitUploadForm } from "./exit-upload-form";

export const metadata: Metadata = { title: "Importar salidas" };

/**
 * Import of daily exits (IMP-10): what was sold or used, kept in another
 * system, arrives as a file and leaves stock. The screen says up to which
 * day exits are imported — that is, how up to date stock is.
 */
export default async function ImportarSalidasPage() {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/inventario/importar"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Importar
    </Link>
  );
  if (!access.can("inventory.import.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Inventario" />
      </PageContainer>
    );
  }
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const [coverage, imports] = await Promise.all([
    getExitCoverage(actor),
    listExitImports(actor),
  ]);
  const canUpload =
    moduleState === "active" && access.allows("inventory.import.create");
  const count = (n: number) => n.toLocaleString("es-MX");

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Importar salidas"
        description="Si tus ventas se registran en otro sistema o en notas, súbelas aquí cada día para que tus existencias sigan siendo las reales."
      />

      <section
        aria-labelledby="al-dia"
        className="max-w-3xl rounded-xl border bg-card p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <CalendarCheck
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          />
          <div className="space-y-1">
            <h2 id="al-dia" className="font-medium">
              {coverage.through
                ? `Salidas importadas hasta el ${formatExitDay(coverage.through)}`
                : "Todavía no has importado salidas"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {coverage.through && coverage.updatedAt ? (
                <>
                  Tus existencias incluyen lo que salió hasta ese día según tus
                  archivos. Última salida registrada:{" "}
                  <time dateTime={coverage.updatedAt.toISOString()}>
                    {formatDateTime(
                      coverage.updatedAt,
                      access.organization.timeZone,
                    )}
                  </time>
                </>
              ) : (
                "Cuando importes tu primer archivo, aquí verás hasta qué día están descontadas tus salidas."
              )}
            </p>
            {coverage.inProgress > 0 && (
              <p className="text-sm tabular-nums">
                {coverage.inProgress === 1
                  ? "1 salida se está registrando"
                  : `${count(coverage.inProgress)} salidas se están registrando`}{" "}
                en segundo plano.
              </p>
            )}
            {coverage.missing > 0 && (
              <p className="flex items-start gap-2 text-sm">
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-warning"
                />
                <span>
                  {coverage.missing === 1
                    ? "1 salida de tus archivos no se pudo descontar"
                    : `${count(coverage.missing)} salidas de tus archivos no se pudieron descontar`}{" "}
                  (por ejemplo, por falta de existencias). Abre el archivo en la
                  lista de abajo para ver cuáles, corrige y súbelo de nuevo: lo
                  que ya se descontó no se repite.
                </span>
              </p>
            )}
          </div>
        </div>
      </section>

      {canUpload && (
        <>
          <section
            aria-labelledby="plantilla"
            className="max-w-3xl space-y-4 rounded-xl border bg-card p-4 sm:p-5"
          >
            <div className="flex items-start gap-3">
              <FileSpreadsheet
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              />
              <div className="space-y-1">
                <h2 id="plantilla" className="font-medium">
                  1. Prepara tu archivo
                </h2>
                <p className="text-sm text-muted-foreground">
                  Una fila por producto vendido, con su fecha, su folio o
                  ticket, la clave (o el código de barras) y la cantidad. Casi
                  cualquier sistema de ventas lo exporta así; si no, usa la
                  plantilla.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a
                  href="/api/importaciones/plantilla-salidas?formato=csv"
                  download
                >
                  <Download aria-hidden="true" data-icon="inline-start" />
                  Plantilla CSV
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href="/api/importaciones/plantilla-salidas?formato=xlsx"
                  download
                >
                  <Download aria-hidden="true" data-icon="inline-start" />
                  Plantilla de Excel (.xlsx)
                </a>
              </Button>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                El folio evita descontar dos veces: si una venta ya se importó,
                subirla otra vez no cambia nada.
              </li>
              <li>
                Fecha como 2026-10-09 o 09/10/2026 (día/mes/año), guardada como
                texto.
              </li>
              <li>
                La cantidad va en la unidad del producto; si la cuentas por caja
                o rollo, llena «Presentación».
              </li>
              <li>«Ubicación» vacía = General.</li>
            </ul>
          </section>
          <section
            aria-labelledby="subir"
            className="max-w-3xl space-y-4 rounded-xl border bg-card p-4 sm:p-5"
          >
            <div className="space-y-1">
              <h2 id="subir" className="font-medium">
                2. Sube tu archivo
              </h2>
              <p className="text-sm text-muted-foreground">
                Primero lo revisamos y te mostramos qué saldría. Nada sale de tu
                inventario hasta que confirmes.
              </p>
            </div>
            <ExitUploadForm />
          </section>
        </>
      )}

      {imports.length > 0 && (
        <section
          aria-labelledby="archivos"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <h2 id="archivos" className="border-b p-4 font-medium sm:px-5">
            Archivos de salidas
          </h2>
          <ul className="divide-y">
            {imports.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/inventario/importar/salidas/${item.id}`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                    {item.fileName}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {count(item.dataRows)}{" "}
                    {item.dataRows === 1 ? "fila" : "filas"} ·{" "}
                    {EXIT_IMPORT_STATUS_LABELS[item.status].toLowerCase()}
                    {item.failedRows > 0 &&
                      ` · ${count(item.failedRows)} sin descontar`}{" "}
                    ·{" "}
                    <time dateTime={item.createdAt.toISOString()}>
                      {formatDateTime(
                        item.createdAt,
                        access.organization.timeZone,
                      )}
                    </time>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
