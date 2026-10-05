import { ChevronLeft, CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IMPORT_COLUMNS, getImport } from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { MappingForm } from "./mapping-form";

export const metadata: Metadata = { title: "Columnas de la importación" };

/** "A", "B", … "AA": the letter Excel shows for a column. */
function columnLetter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * Second step of an import (IMP-04): what was read from the file, which
 * of its columns is each of ours and how it writes decimals.
 */
export default async function ImportacionPage({
  params,
}: PageProps<"/inventario/importar/[id]">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/inventario/importar"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Importar productos
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
  const { id } = await params;
  const detail = await getImport(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!detail) notFound();

  const canMap =
    moduleState === "active" && access.allows("inventory.import.create");
  const fileColumns = detail.headers.map((header, index) => ({
    index,
    label: header
      ? `${columnLetter(index)} · ${header}`
      : `${columnLetter(index)} · (sin título)`,
  }));
  const chosen = new Map(
    Object.entries(detail.mapping).map(([key, index]) => [index, key]),
  );
  const ours = (key: string) =>
    IMPORT_COLUMNS.find((column) => column.key === key)?.header;
  const unreadable = detail.numbers.reduce(
    (count, column) =>
      count + column.samples.filter((sample) => sample.value === null).length,
    0,
  );

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Columnas de tu archivo"
        description={`${detail.fileName}${detail.sheetName ? ` · hoja «${detail.sheetName}»` : ""}`}
      />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <Badge variant={detail.status === "READY" ? "default" : "secondary"}>
          {detail.status === "READY"
            ? "Columnas listas"
            : "Falta elegir columnas"}
        </Badge>
        <span className="tabular-nums">
          {detail.dataRows === 1
            ? "1 fila con datos"
            : `${detail.dataRows.toLocaleString("es-MX")} filas con datos`}{" "}
          · títulos en la fila {detail.headerRow}
        </span>
      </p>
      {detail.formulaCells > 0 && (
        <p className="flex max-w-3xl items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm">
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <span>
            {detail.formulaCells === 1
              ? "1 celda tiene una fórmula"
              : `${detail.formulaCells.toLocaleString("es-MX")} celdas tienen fórmulas`}
            . No se ejecutan: se toma el resultado que Excel dejó guardado. Si
            cambiaste algo sin guardar, vuelve a guardar el archivo y súbelo de
            nuevo.
          </span>
        </p>
      )}

      <section
        aria-labelledby="vista-previa"
        className="rounded-xl border bg-card"
      >
        <h2 id="vista-previa" className="border-b p-4 font-medium sm:px-5">
          Así leímos tus primeras filas
        </h2>
        {/* A table of the person's own file: it scrolls inside its box. */}
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-labelledby="vista-previa"
        >
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b">
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  Fila
                </th>
                {detail.headers.map((header, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="px-4 py-2 align-top font-medium"
                  >
                    <span className="block text-muted-foreground">
                      {columnLetter(index)}
                    </span>
                    {header || "(sin título)"}
                    {chosen.has(index) && (
                      <span className="block font-normal text-primary">
                        → {ours(chosen.get(index)!)}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {detail.preview.map((line) => (
                <tr key={line.row}>
                  <th
                    scope="row"
                    className="px-4 py-2 font-normal text-muted-foreground tabular-nums sm:px-5"
                  >
                    {line.row}
                  </th>
                  {line.cells.map((cell, index) => (
                    <td
                      key={index}
                      className="max-w-64 truncate px-4 py-2 tabular-nums"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canMap ? (
        <section
          aria-label="Elegir columnas"
          className="rounded-xl border bg-card p-4 sm:p-5"
        >
          <MappingForm
            importId={detail.id}
            columns={IMPORT_COLUMNS.map((column) => ({
              key: column.key,
              header: column.header,
              required: column.required,
              help: column.help,
            }))}
            fileColumns={fileColumns}
            mapping={Object.fromEntries(
              IMPORT_COLUMNS.map((column) => [
                column.key,
                detail.mapping[column.key] === undefined
                  ? ""
                  : String(detail.mapping[column.key]),
              ]),
            )}
            decimalSeparator={detail.decimalSeparator ?? ""}
          />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          Puedes consultar esta importación, pero no cambiar sus columnas.
        </p>
      )}

      {detail.decimalSeparator && (
        <section
          aria-labelledby="numeros"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <h2 id="numeros" className="border-b p-4 font-medium sm:px-5">
            Así se leen tus números (decimales con{" "}
            {detail.decimalSeparator === "." ? "punto" : "coma"})
          </h2>
          {detail.numbers.every((column) => column.samples.length === 0) ? (
            <p className="p-4 text-sm text-muted-foreground sm:px-5">
              Las primeras filas no traen números en las columnas elegidas.
            </p>
          ) : (
            <ul className="divide-y">
              {detail.numbers
                .filter((column) => column.samples.length > 0)
                .map((column) => (
                  <li key={column.column} className="space-y-1 p-4 sm:px-5">
                    <p className="font-medium">{column.header}</p>
                    <ul className="text-sm tabular-nums">
                      {column.samples.map((sample) => (
                        <li
                          key={sample.row}
                          className="flex flex-wrap items-center gap-x-2"
                        >
                          <span className="text-muted-foreground">
                            Fila {sample.row}: «{sample.text}»
                          </span>
                          {sample.value === null ? (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <CircleAlert
                                aria-hidden="true"
                                className="size-4"
                              />
                              no se entiende así
                            </span>
                          ) : (
                            <span className="font-medium">
                              → {sample.value}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
            </ul>
          )}
          <p className="flex items-start gap-2 border-t p-4 text-sm sm:px-5">
            {unreadable > 0 ? (
              <>
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                />
                Hay números que no se entienden con esa forma de escribir
                decimales. Si elegiste la equivocada, cámbiala arriba.
              </>
            ) : (
              <>
                <CircleCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-success"
                />
                Todavía no se importó nada. Revisa ahora cada fila y te muestra
                los errores antes de confirmar.
              </>
            )}
          </p>
        </section>
      )}
      {detail.status === "READY" && (
        <p>
          <Button asChild>
            <Link href={`/inventario/importar/${detail.id}/revision`}>
              Revisar las filas
            </Link>
          </Button>
        </p>
      )}
    </PageContainer>
  );
}
