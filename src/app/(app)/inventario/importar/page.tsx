import { ChevronLeft, Download, FileSpreadsheet } from "lucide-react";
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
  IMPORT_COLUMNS,
  IMPORT_STATUS_LABELS,
  listImports,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Importar productos" };

/**
 * Import of the catalog from a spreadsheet. First step (IMP-03): the
 * template to fill in, in Excel or CSV, with examples of units and
 * presentations.
 */
export default async function ImportarPage() {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/inventario"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Inventario
    </Link>
  );
  if (!access.can("inventory.import.create")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        {back}
        {moduleState === "none" ? (
          <NoModuleState module="Inventario" />
        ) : (
          <ReadOnlyNotice module="Inventario" />
        )}
      </PageContainer>
    );
  }
  const imports = access.can("inventory.import.read")
    ? await listImports({
        organizationId: access.organization.id,
        userId: access.user.id,
      })
    : [];
  const required = IMPORT_COLUMNS.filter((column) => column.required).map(
    (column) => column.header,
  );

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Importar productos"
        description="Trae tu catálogo y tus existencias desde Excel, sin capturarlos uno por uno."
      />
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
              1. Descarga la plantilla
            </h2>
            <p className="text-sm text-muted-foreground">
              Trae los títulos de cada columna y ejemplos de productos por
              pieza, por metro y por kilogramo, con y sin presentación (caja,
              rollo, saco). La de Excel incluye una hoja de instrucciones con
              las unidades válidas.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href="/api/importaciones/plantilla?formato=xlsx" download>
              <Download aria-hidden="true" data-icon="inline-start" />
              Plantilla de Excel (.xlsx)
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href="/api/importaciones/plantilla?formato=csv" download>
              <Download aria-hidden="true" data-icon="inline-start" />
              Plantilla CSV
            </a>
          </Button>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            Cada fila es un producto. Son obligatorias: {required.join(", ")}.
          </li>
          <li>
            La unidad es en qué lo controlas (pieza, metro, kilogramo). Una caja
            o un rollo van en «Presentación», con cuánto traen.
          </li>
          <li>
            «3» de «Caja» con contenido 100 se registra como 300 piezas de
            existencia inicial.
          </li>
          <li>Decimales con punto (2.75), sin separador de miles.</li>
          <li>Borra las filas de ejemplo antes de importar.</li>
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
            Puede ser la plantilla llena o tu propio Excel: en el siguiente paso
            eliges qué columna es cada dato. Subirlo no cambia tu inventario.
          </p>
        </div>
        <UploadForm />
      </section>
      <section
        aria-labelledby="salidas"
        className="max-w-3xl space-y-3 rounded-xl border bg-card p-4 sm:p-5"
      >
        <div className="space-y-1">
          <h2 id="salidas" className="font-medium">
            ¿Tus ventas se registran en otro sistema?
          </h2>
          <p className="text-sm text-muted-foreground">
            Sube cada día el archivo de lo que salió y se descuenta de tus
            existencias, sin capturarlo a mano y sin descontar dos veces.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/inventario/importar/salidas">
            Importar salidas diarias
          </Link>
        </Button>
      </section>
      {imports.length > 0 && (
        <section
          aria-labelledby="importaciones"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <h2 id="importaciones" className="border-b p-4 font-medium sm:px-5">
            Archivos que has subido
          </h2>
          <ul className="divide-y">
            {imports.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/inventario/importar/${item.id}`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                    {item.fileName}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {item.dataRows.toLocaleString("es-MX")}{" "}
                    {item.dataRows === 1 ? "fila" : "filas"} ·{" "}
                    {IMPORT_STATUS_LABELS[item.status].toLowerCase()} ·{" "}
                    <time dateTime={item.createdAt.toISOString()}>
                      {formatDateTime(item.createdAt)}
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
