import { ChevronLeft, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { formatDateTime } from "@/lib";
import {
  IMPORT_COLUMNS,
  IMPORT_STATUS_LABELS,
  listImports,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { ImportSteps } from "./import-steps";
import { UploadForm } from "./upload-form";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

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
      <ImportSteps current={1} />
      <PageHeader title="Importar productos" />
      <section
        aria-labelledby="subir"
        className="max-w-3xl space-y-4 rounded-xl border bg-card p-4 sm:p-5"
      >
        <h2 id="subir" className="sr-only">
          Sube tu archivo
        </h2>
        <UploadForm />
        <div className="space-y-2 border-t pt-4">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              ¿No tienes uno? Descarga la plantilla:
            </span>
            <a
              href="/api/importaciones/plantilla?formato=xlsx"
              download
              className={linkClass}
            >
              <Download aria-hidden="true" className="size-4" />
              Excel
            </a>
            <a
              href="/api/importaciones/plantilla?formato=csv"
              download
              className={linkClass}
            >
              <Download aria-hidden="true" className="size-4" />
              CSV
            </a>
          </p>
          <details className="text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              Cómo llenarla
            </summary>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                Una fila por producto. Obligatorias: {required.join(", ")}.
              </li>
              <li>
                Unidad: pieza, metro, kilogramo… Una caja o un rollo van en
                «Presentación», con cuánto traen.
              </li>
              <li>Decimales con punto (2.75), sin separador de miles.</li>
              <li>Borra las filas de ejemplo.</li>
            </ul>
          </details>
        </div>
      </section>
      {imports.length > 0 && (
        <section
          aria-labelledby="importaciones"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <h2 id="importaciones" className="border-b p-4 font-medium sm:px-5">
            Archivos anteriores
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
      <p>
        <Link
          href="/inventario/importar/salidas"
          className="inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          ¿Vendes con otro sistema? Importa tus salidas diarias
        </Link>
      </p>
    </PageContainer>
  );
}
