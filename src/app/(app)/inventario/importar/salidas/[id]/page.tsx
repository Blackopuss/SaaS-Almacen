import { ChevronLeft, CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { Button } from "@/components/ui/button";
import {
  formatExitDay,
  listExitImportFailures,
  reviewExitImport,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { CancelExitImport, ConfirmExitImport } from "./exit-import-buttons";

export const metadata: Metadata = { title: "Revisión de salidas" };

/**
 * A file of exits (IMP-10): before confirming, every row checked and what
 * would leave stock; after, how far the worker got and what could not be
 * registered. Opening the screen writes nothing.
 */
export default async function SalidasImportadasPage({
  params,
}: PageProps<"/inventario/importar/salidas/[id]">) {
  const access = await getModuleAccess();
  const { id } = await params;
  const back = (
    <Link
      href="/inventario/importar/salidas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Importar salidas
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
  const review = await reviewExitImport(actor, id);
  if (!review.ok && review.reason === "not_found") notFound();
  if (!review.ok) {
    return (
      <PageContainer>
        {back}
        <PageHeader title="Revisión de tus salidas" />
        <EmptyState
          icon={CircleAlert}
          title="No se puede leer el archivo"
          description={review.error}
          action={
            <Button asChild variant="outline">
              <Link href="/inventario/importar/salidas">
                Subir otro archivo
              </Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const count = (n: number) => n.toLocaleString("es-MX");
  const rows = (n: number) => (n === 1 ? "1 fila" : `${count(n)} filas`);
  const exits = (n: number) => (n === 1 ? "1 salida" : `${count(n)} salidas`);
  const days = (first: string | null, last: string | null) =>
    !first || !last
      ? null
      : first === last
        ? `del ${formatExitDay(first)}`
        : `del ${formatExitDay(first)} al ${formatExitDay(last)}`;
  const { check, progress, status } = review;
  const active = moduleState === "active";
  const canConfirm =
    status === "READY" &&
    Boolean(check?.ready) &&
    active &&
    access.allows("inventory.import.confirm") &&
    access.allows("inventory.exit.create");
  const canCancel =
    (status === "READY" || status === "CONFIRMED" || status === "RUNNING") &&
    active &&
    access.allows("inventory.import.cancel");
  const failures =
    progress.failedRows > 0 ? await listExitImportFailures(actor, id) : [];
  const pending =
    progress.totalRows -
    progress.appliedRows -
    progress.duplicateRows -
    progress.failedRows;

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Revisión de tus salidas"
        description={review.fileName}
      />

      {check && (
        <>
          <div
            role="status"
            className={`flex max-w-3xl items-start gap-2 rounded-xl border p-4 text-sm ${
              check.ready
                ? "border-success/30 bg-success/10"
                : "border-destructive/30 bg-destructive/10"
            }`}
          >
            {check.ready ? (
              <CircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
            ) : (
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
            )}
            <p>
              {check.ready ? (
                <>
                  <span className="font-medium">
                    {check.totalRows === 1
                      ? "La fila está correcta"
                      : `Las ${count(check.totalRows)} filas están correctas`}
                  </span>
                  : {exits(check.toApply)} por descontar
                  {days(check.firstDay, check.lastDay) &&
                    `, ${days(check.firstDay, check.lastDay)}`}
                  , en{" "}
                  {check.tickets === 1
                    ? "1 folio"
                    : `${count(check.tickets)} folios`}
                  . Todavía no salió nada de tu inventario.
                </>
              ) : (
                <>
                  <span className="font-medium">
                    {rows(check.invalidRows)} con problemas
                  </span>{" "}
                  de {count(check.totalRows)}. Corrige tu archivo y súbelo de
                  nuevo: no se descuenta una parte. No salió nada de tu
                  inventario.
                </>
              )}
            </p>
          </div>

          {check.alreadyImported > 0 && (
            <p
              role="status"
              className="flex max-w-3xl items-start gap-2 rounded-xl border bg-card p-4 text-sm"
            >
              <CircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span>
                <span className="font-medium">
                  {check.alreadyImported === 1
                    ? "1 fila ya se había importado"
                    : `${count(check.alreadyImported)} filas ya se habían importado`}
                </span>{" "}
                (mismo folio y producto): no se descontarán otra vez.
              </span>
            </p>
          )}

          {check.issues.length > 0 && (
            <section
              aria-labelledby="problemas"
              className="rounded-xl border bg-card"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
                <h2 id="problemas" className="font-medium">
                  Qué corregir
                </h2>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {check.issueCount === 1
                    ? "1 problema"
                    : `${count(check.issueCount)} problemas`}
                </p>
              </div>
              <div
                className="overflow-x-auto"
                tabIndex={0}
                role="region"
                aria-labelledby="problemas"
              >
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                        Fila
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Columna
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Dice
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Problema
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {check.issues.map((issue, index) => (
                      <tr key={index} className="align-top">
                        <th
                          scope="row"
                          className="px-4 py-2 font-medium tabular-nums sm:px-5"
                        >
                          {issue.row}
                        </th>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {issue.header || "Toda la fila"}
                        </td>
                        <td className="max-w-48 px-4 py-2 [overflow-wrap:anywhere] text-muted-foreground tabular-nums">
                          {issue.value === "" ? "(vacío)" : issue.value}
                        </td>
                        <td className="min-w-64 px-4 py-2">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {check.issueCount > check.issues.length && (
                <p className="border-t p-4 text-sm text-muted-foreground sm:px-5">
                  Se muestran los primeros {count(check.issues.length)}{" "}
                  problemas. Corrígelos y vuelve a subir el archivo para ver el
                  resto.
                </p>
              )}
            </section>
          )}

          {check.preview.length > 0 && (
            <section
              aria-labelledby="entendido"
              className="max-w-3xl rounded-xl border bg-card"
            >
              <div className="space-y-1 border-b p-4 sm:px-5">
                <h2 id="entendido" className="font-medium">
                  Así se entienden tus filas correctas
                </h2>
                <p className="text-sm text-muted-foreground">
                  {check.validRows > check.preview.length
                    ? `Las primeras ${check.preview.length} de ${count(check.validRows)}.`
                    : "Revisa que productos, cantidades y ubicaciones sean lo que esperas."}
                </p>
              </div>
              <ul className="divide-y">
                {check.preview.map((line) => (
                  <li key={line.row} className="space-y-1 p-4 text-sm sm:px-5">
                    <p className="text-muted-foreground tabular-nums">
                      Fila {line.row} · {formatExitDay(line.day)} ·{" "}
                      <span className="[overflow-wrap:anywhere]">
                        folio {line.externalId}
                      </span>
                    </p>
                    <p className="[overflow-wrap:anywhere]">{line.text}</p>
                  </li>
                ))}
              </ul>
              {(canConfirm || canCancel) && (
                <div className="flex flex-wrap gap-3 border-t p-4 sm:px-5">
                  {canConfirm && check.toApply > 0 && (
                    <ConfirmExitImport
                      importId={review.id}
                      toApply={check.toApply}
                      alreadyImported={check.alreadyImported}
                    />
                  )}
                  {canCancel && (
                    <CancelExitImport importId={review.id} started={false} />
                  )}
                </div>
              )}
              {canConfirm && check.toApply === 0 && (
                <p className="border-t p-4 text-sm text-muted-foreground sm:px-5">
                  Todo lo de este archivo ya estaba importado: no hay nada por
                  descontar.
                </p>
              )}
            </section>
          )}
          {check.preview.length === 0 && canCancel && (
            <div>
              <CancelExitImport importId={review.id} started={false} />
            </div>
          )}
        </>
      )}

      {!check && (
        <section
          aria-labelledby="estado"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <div
            role="status"
            className="flex items-start gap-2 p-4 text-sm sm:p-5"
          >
            {status === "DONE" && progress.failedRows === 0 ? (
              <CircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
            ) : status === "DONE" || status === "FAILED" ? (
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-warning"
              />
            ) : (
              <CircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
            )}
            <div className="space-y-1">
              <h2 id="estado" className="font-medium">
                {status === "DONE"
                  ? "Salidas registradas"
                  : status === "RUNNING"
                    ? "Registrando salidas…"
                    : status === "CONFIRMED"
                      ? "Confirmada, en espera"
                      : status === "FAILED"
                        ? "La importación no pudo terminar"
                        : "Importación cancelada"}
              </h2>
              {progress.totalRows > 0 ? (
                <p className="tabular-nums">
                  {progress.appliedRows === 1
                    ? "1 salida descontada de tu inventario"
                    : `${count(progress.appliedRows)} salidas descontadas de tu inventario`}
                  {days(progress.firstDay, progress.lastDay) &&
                    ` (archivo ${days(progress.firstDay, progress.lastDay)})`}
                  {progress.duplicateRows > 0 &&
                    `; ${progress.duplicateRows === 1 ? "1 ya estaba importada" : `${count(progress.duplicateRows)} ya estaban importadas`}`}
                  {progress.failedRows > 0 &&
                    `; ${progress.failedRows === 1 ? "1 no se pudo descontar" : `${count(progress.failedRows)} no se pudieron descontar`} (abajo dice por qué)`}
                  {pending > 0 &&
                    `; ${pending === 1 ? "falta 1" : `faltan ${count(pending)}`}`}
                  .
                </p>
              ) : (
                <p>No salió nada de tu inventario.</p>
              )}
              {(status === "CONFIRMED" || status === "RUNNING") && (
                <p className="text-muted-foreground">
                  Se registra en segundo plano: puedes salir de esta pantalla y
                  volver a abrirla para ver el avance.
                </p>
              )}
              {progress.lastError && (
                <p className="text-destructive">{progress.lastError}</p>
              )}
              {canCancel && (
                <div className="pt-2">
                  <CancelExitImport importId={review.id} started />
                </div>
              )}
              {status === "DONE" && (
                <p>
                  <Link
                    href="/movimientos"
                    className="inline-flex min-h-11 items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Ver los movimientos
                  </Link>
                </p>
              )}
            </div>
          </div>
          {failures.length > 0 && (
            <ul className="divide-y border-t">
              {failures.map((failure) => (
                <li key={failure.row} className="space-y-1 p-4 text-sm sm:px-5">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {failure.sku}
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {" "}
                      · fila {failure.row} · folio {failure.externalId} ·{" "}
                      {formatExitDay(failure.day)}
                    </span>
                  </p>
                  <p>{failure.error}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </PageContainer>
  );
}
