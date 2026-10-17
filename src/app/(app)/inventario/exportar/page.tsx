import { ChevronLeft, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  FormField,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXPORT_KINDS, type ExportKind } from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Exportar a Excel" };

const DESCRIPTIONS: Record<ExportKind, string> = {
  catalogo:
    "Todos tus productos, activos y archivados: clave, nombre, categoría, marca, código de barras, unidad y mínimo.",
  existencias:
    "Cuánto hay de cada producto en cada ubicación, en la unidad del producto.",
  movimientos:
    "Cada entrada, salida, reubicación, ajuste y reversa: cuándo, qué, dónde, cuánto, por qué y quién.",
};

/**
 * Exports to a spreadsheet (IMP-11). Each block is a plain download link;
 * it is shown only to who may read what it contains. Exporting stays
 * available with the plan in read-only: it changes nothing.
 */
export default async function ExportarPage() {
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
  if (!access.can("inventory.export.create")) {
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
  const kinds = (Object.keys(EXPORT_KINDS) as ExportKind[]).filter((kind) =>
    access.can(EXPORT_KINDS[kind].reads),
  );

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Exportar a Excel"
        description="Descarga tu información para revisarla, respaldarla o compartirla con tu contador. El archivo trae lo que hay en este momento."
      />
      {kinds.length === 0 && <NoAccessState />}
      {kinds.map((kind) => (
        <section
          key={kind}
          aria-labelledby={`exportar-${kind}`}
          className="max-w-3xl space-y-4 rounded-xl border bg-card p-4 sm:p-5"
        >
          <div className="space-y-1">
            <h2 id={`exportar-${kind}`} className="font-medium">
              {EXPORT_KINDS[kind].label}
            </h2>
            <p className="text-sm text-muted-foreground">
              {DESCRIPTIONS[kind]}
            </p>
          </div>
          {kind === "movimientos" ? (
            // A plain GET form, not next/form: the answer is a file to
            // download, not a screen to navigate to. The dates travel in
            // the address; nothing is sent to a Server Action.
            <form
              method="get"
              action="/api/exportaciones/movimientos"
              className="space-y-4"
            >
              <div className="grid max-w-md grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  id="desde"
                  label="Desde"
                  hint="Vacío = desde el principio."
                >
                  {(control) => <Input {...control} name="desde" type="date" />}
                </FormField>
                <FormField id="hasta" label="Hasta" hint="Vacío = hasta hoy.">
                  {(control) => <Input {...control} name="hasta" type="date" />}
                </FormField>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="formato" value="xlsx">
                  <Download aria-hidden="true" data-icon="inline-start" />
                  Excel (.xlsx)
                </Button>
                <Button
                  type="submit"
                  name="formato"
                  value="csv"
                  variant="outline"
                >
                  <Download aria-hidden="true" data-icon="inline-start" />
                  CSV
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <a href={`/api/exportaciones/${kind}?formato=xlsx`} download>
                  <Download aria-hidden="true" data-icon="inline-start" />
                  Excel (.xlsx)
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={`/api/exportaciones/${kind}?formato=csv`} download>
                  <Download aria-hidden="true" data-icon="inline-start" />
                  CSV
                </a>
              </Button>
            </div>
          )}
        </section>
      ))}
      <p className="max-w-3xl text-sm text-muted-foreground">
        Las celdas se guardan como texto: un nombre o una nota que empiece con
        «=», «+», «-» o «@» llega con un apóstrofo delante para que Excel no lo
        ejecute como fórmula. Cada exportación queda anotada en la bitácora.
      </p>
    </PageContainer>
  );
}
