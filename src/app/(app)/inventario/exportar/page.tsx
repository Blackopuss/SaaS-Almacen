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

export const metadata: Metadata = { title: "Descargar en Excel" };

const DESCRIPTIONS: Record<ExportKind, string> = {
  catalogo: "Todos tus productos, también los archivados.",
  existencias: "Cuánto hay de cada producto en cada ubicación.",
  movimientos: "Entradas, salidas y ajustes, con fecha y quién.",
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
      <PageHeader title="Descargar en Excel" />
      {kinds.length === 0 && <NoAccessState />}
      {kinds.length > 0 && (
        <ul className="max-w-3xl divide-y rounded-xl border bg-card">
          {kinds.map((kind) => (
            <li key={kind} className="space-y-3 p-4 sm:px-5">
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
                  aria-labelledby={`exportar-${kind}`}
                  className="flex flex-wrap items-end gap-2"
                >
                  <FormField id="desde" label="Desde (opcional)">
                    {(control) => (
                      <Input {...control} name="desde" type="date" />
                    )}
                  </FormField>
                  <FormField id="hasta" label="Hasta (opcional)">
                    {(control) => (
                      <Input {...control} name="hasta" type="date" />
                    )}
                  </FormField>
                  <Button
                    type="submit"
                    name="formato"
                    value="xlsx"
                    variant="outline"
                  >
                    <Download aria-hidden="true" data-icon="inline-start" />
                    Excel
                  </Button>
                  <Button
                    type="submit"
                    name="formato"
                    value="csv"
                    variant="ghost"
                  >
                    CSV
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a
                      href={`/api/exportaciones/${kind}?formato=xlsx`}
                      download
                    >
                      <Download aria-hidden="true" data-icon="inline-start" />
                      Excel
                    </a>
                  </Button>
                  <Button asChild variant="ghost">
                    <a href={`/api/exportaciones/${kind}?formato=csv`} download>
                      CSV
                    </a>
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
