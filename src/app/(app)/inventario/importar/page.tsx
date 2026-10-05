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
import { IMPORT_COLUMNS } from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

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
      <p className="max-w-3xl text-sm text-muted-foreground">
        El siguiente paso —subir tu archivo, revisar errores y confirmar— se
        habilitará aquí mismo. Por ahora puedes ir llenando la plantilla.
      </p>
    </PageContainer>
  );
}
