import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  classifyImport,
  getImport,
  isImportEditable,
  listImportFailures,
  validateImport,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { ConfirmImport } from "./confirm-import";

export const metadata: Metadata = { title: "Revisión de la importación" };

const ISSUES_PER_PAGE = 50;
/** Products of the file listed with what happens to each. */
const PRODUCTS_SHOWN = 20;

const KIND = {
  new: { label: "Nuevo", variant: "default" },
  update: { label: "Se actualiza", variant: "secondary" },
  reactivate: { label: "Se reactiva", variant: "warning" },
} as const;

/**
 * Third step of an import (IMP-05): every row checked, with its problems
 * by row and column, and how the rows that are right will be understood.
 * The check runs each time the screen opens and writes nothing.
 */
export default async function RevisionPage({
  params,
  searchParams,
}: PageProps<"/inventario/importar/[id]/revision">) {
  const access = await getModuleAccess();
  const { id } = await params;
  const back = (
    <Link
      href={`/inventario/importar/${id}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Columnas de tu archivo
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
  const result = await validateImport(actor, id);
  if (!result.ok && result.reason === "not_found") notFound();
  if (!result.ok) {
    return (
      <PageContainer>
        {back}
        <PageHeader title="Revisión de tu archivo" />
        <EmptyState
          icon={CircleAlert}
          title="Todavía no se puede revisar"
          description={result.error}
          action={
            <Button asChild variant="outline">
              <Link href={`/inventario/importar/${id}`}>Ir a las columnas</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const count = (n: number) => n.toLocaleString("es-MX");
  const rows = (n: number) => (n === 1 ? "1 fila" : `${count(n)} filas`);
  const { pagina } = await searchParams;
  const pageCount = Math.max(
    1,
    Math.ceil(result.issues.length / ISSUES_PER_PAGE),
  );
  const page = Math.min(
    Math.max(
      typeof pagina === "string" && /^\d{1,4}$/.test(pagina)
        ? Number(pagina)
        : 1,
      1,
    ),
    pageCount,
  );
  const shown = result.issues.slice(
    (page - 1) * ISSUES_PER_PAGE,
    page * ISSUES_PER_PAGE,
  );
  const pageHref = (n: number) =>
    n > 1
      ? `/inventario/importar/${id}/revision?pagina=${n}`
      : `/inventario/importar/${id}/revision`;
  const clean = result.invalidRows === 0;
  // New or existing, and the places of the plan they need (IMP-06).
  const [classified, detail] = await Promise.all([
    classifyImport(actor, id),
    getImport(actor, id),
  ]);
  const plan = classified.ok ? classified : null;
  // Once confirmed its places are held: the question is no longer whether
  // it fits.
  const editable = detail ? isImportEditable(detail.status) : false;
  const failures =
    detail && detail.failedItems > 0 ? await listImportFailures(actor, id) : [];
  const canConfirm =
    editable &&
    Boolean(plan?.ready) &&
    moduleState === "active" &&
    access.allows("inventory.import.confirm");

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Revisión de tu archivo"
        description={result.fileName}
      />

      <div
        role="status"
        className={`flex max-w-3xl items-start gap-2 rounded-xl border p-4 text-sm ${
          clean
            ? "border-success/30 bg-success/10"
            : "border-destructive/30 bg-destructive/10"
        }`}
      >
        {clean ? (
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
          {clean ? (
            <>
              <span className="font-medium">
                {result.totalRows === 1
                  ? "La fila está correcta"
                  : `Las ${count(result.totalRows)} filas están correctas`}
              </span>
              :{" "}
              {result.products === 1
                ? "1 producto"
                : `${count(result.products)} productos`}
              . Todavía no se importó nada.
            </>
          ) : (
            <>
              <span className="font-medium">
                {rows(result.invalidRows)} con problemas
              </span>{" "}
              de {count(result.totalRows)}; {rows(result.validRows)}{" "}
              {result.validRows === 1 ? "correcta" : "correctas"}. Corrige tu
              archivo, súbelo de nuevo y vuelve a revisar. No se importó ni se
              cambió nada.
            </>
          )}
        </p>
      </div>

      {result.issues.length > 0 && (
        <section
          aria-labelledby="problemas"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="problemas" className="font-medium">
              Qué corregir
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {result.issueCount === 1
                ? "1 problema"
                : `${count((page - 1) * ISSUES_PER_PAGE + 1)}–${count((page - 1) * ISSUES_PER_PAGE + shown.length)} de ${count(result.issueCount)} problemas`}
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
                {shown.map((issue, index) => (
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
          {result.issueCount > result.issues.length && (
            <p className="border-t p-4 text-sm text-muted-foreground sm:px-5">
              Se muestran los primeros {count(result.issues.length)} problemas.
              Corrígelos y vuelve a subir el archivo para ver el resto.
            </p>
          )}
          {pageCount > 1 && (
            <nav
              aria-label="Páginas de problemas"
              className="flex items-center justify-between gap-3 border-t p-4 sm:px-5"
            >
              {page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(page - 1)} rel="prev">
                    <ChevronLeft aria-hidden="true" data-icon="inline-start" />
                    Anterior
                  </Link>
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-sm text-muted-foreground tabular-nums">
                Página {count(page)} de {count(pageCount)}
              </p>
              {page < pageCount ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(page + 1)} rel="next">
                    Siguiente
                    <ChevronRight aria-hidden="true" data-icon="inline-end" />
                  </Link>
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
            </nav>
          )}
        </section>
      )}

      {detail && !editable && (
        <section
          aria-labelledby="estado-importacion"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <div
            role="status"
            className="flex items-start gap-2 p-4 text-sm sm:p-5"
          >
            {detail.status === "DONE" && detail.failedItems === 0 ? (
              <CircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
            ) : detail.status === "DONE" || detail.status === "FAILED" ? (
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
              <h2 id="estado-importacion" className="font-medium">
                {detail.status === "DONE"
                  ? "Importación terminada"
                  : detail.status === "RUNNING"
                    ? "Importando…"
                    : detail.status === "CONFIRMED"
                      ? "Importación confirmada, en espera"
                      : detail.status === "FAILED"
                        ? "La importación no pudo terminar"
                        : "Importación cancelada"}
              </h2>
              {detail.status === "DONE" ? (
                <p>
                  {detail.processedItems - detail.failedItems === 1
                    ? "1 producto quedó en tu catálogo"
                    : `${count(detail.processedItems - detail.failedItems)} productos quedaron en tu catálogo`}
                  {detail.failedItems > 0 &&
                    `; ${detail.failedItems === 1 ? "1 no se pudo importar" : `${count(detail.failedItems)} no se pudieron importar`} (abajo dice por qué)`}
                  .
                </p>
              ) : detail.status === "CANCELLED" ? (
                <p>No cambió nada en tu inventario.</p>
              ) : (
                <p className="tabular-nums">
                  {count(detail.processedItems)} de {count(detail.totalItems)}{" "}
                  productos procesados
                  {detail.reservedPlaces > 0 &&
                    ` · ${detail.reservedPlaces === 1 ? "1 lugar apartado" : `${count(detail.reservedPlaces)} lugares apartados`} de tu plan`}
                  . Se aplica en segundo plano: puedes salir de esta pantalla y
                  volver a abrirla para ver el avance.
                </p>
              )}
              {detail.lastError && (
                <p className="text-destructive">{detail.lastError}</p>
              )}
              {detail.status === "DONE" && (
                <p>
                  <Link
                    href="/inventario"
                    className="inline-flex min-h-11 items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Ver tu inventario
                  </Link>
                </p>
              )}
            </div>
          </div>
          {failures.length > 0 && (
            <ul className="divide-y border-t">
              {failures.map((failure) => (
                <li key={failure.sku} className="space-y-1 p-4 text-sm sm:px-5">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {failure.sku}
                    {failure.row !== null && (
                      <span className="font-normal text-muted-foreground tabular-nums">
                        {" "}
                        · fila {failure.row}
                      </span>
                    )}
                  </p>
                  <p>{failure.error}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {plan && plan.validRows > 0 && editable && (
        <section
          aria-labelledby="clasificacion"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <div className="space-y-3 border-b p-4 sm:p-5">
            <h2 id="clasificacion" className="font-medium">
              Qué pasará con tus productos
            </h2>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              {(
                [
                  ["Nuevos", plan.counts.new],
                  ["Se actualizan", plan.counts.update],
                  ["Se reactivan", plan.counts.reactivate],
                ] as const
              ).map(([term, value]) => (
                <div key={term}>
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="text-2xl font-semibold tracking-tight tabular-nums">
                    {count(value)}
                  </dd>
                </div>
              ))}
            </dl>
            <p
              className="flex items-start gap-2 text-sm"
              role={plan.quota.fits ? undefined : "alert"}
            >
              {plan.quota.fits ? (
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
              <span>
                {plan.quota.limit === null ? (
                  "Tu empresa todavía no tiene un plan con cupo de productos: no se pueden agregar productos nuevos."
                ) : plan.quota.required === 0 ? (
                  "No necesita lugares de tu plan: solo actualiza productos que ya tienes."
                ) : (
                  <>
                    Necesita{" "}
                    <span className="font-medium tabular-nums">
                      {plan.quota.required === 1
                        ? "1 lugar"
                        : `${count(plan.quota.required)} lugares`}
                    </span>{" "}
                    de tu plan (productos nuevos y reactivados). Tienes{" "}
                    <span className="font-medium tabular-nums">
                      {count(plan.quota.available)}
                    </span>{" "}
                    disponibles de {count(plan.quota.limit)}.
                    {!plan.quota.fits &&
                      ` Faltan ${count(plan.quota.required - plan.quota.available)}: quita productos del archivo, archiva los que ya no uses o pide un nivel mayor. No se importará una parte.`}
                  </>
                )}{" "}
                {plan.quota.fits && plan.quota.required > 0 && (
                  <span className="text-muted-foreground">
                    Los lugares se apartan al confirmar.
                  </span>
                )}
              </span>
            </p>
          </div>
          {plan.conflicts.length > 0 && (
            <div className="border-b">
              <h3 className="flex items-center gap-2 px-4 pt-4 text-sm font-medium sm:px-5">
                <CircleAlert
                  aria-hidden="true"
                  className="size-4 text-destructive"
                />
                {plan.conflictCount === 1
                  ? "1 choque con tu catálogo actual"
                  : `${count(plan.conflictCount)} choques con tu catálogo actual`}
              </h3>
              <ul className="divide-y">
                {plan.conflicts.map((conflict, index) => (
                  <li key={index} className="space-y-1 p-4 text-sm sm:px-5">
                    <p className="text-muted-foreground tabular-nums">
                      Fila {conflict.row} · {conflict.header}
                      {conflict.value && ` · dice «${conflict.value}»`}
                    </p>
                    <p>{conflict.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="divide-y">
            {plan.products.slice(0, PRODUCTS_SHOWN).map((product) => (
              <li key={product.row} className="space-y-1 p-4 sm:px-5">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant={KIND[product.kind].variant}>
                    {KIND[product.kind].label}
                  </Badge>
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {product.name}
                  </span>
                  <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    {product.sku}
                  </span>
                </p>
                {product.changes.length > 0 && (
                  <ul className="text-sm text-muted-foreground">
                    {product.changes.map((change) => (
                      <li key={change} className="[overflow-wrap:anywhere]">
                        {change}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {plan.counts.new + plan.counts.update + plan.counts.reactivate >
            PRODUCTS_SHOWN && (
            <p className="border-t p-4 text-sm text-muted-foreground sm:px-5">
              Se muestran los primeros {PRODUCTS_SHOWN} productos del archivo.
            </p>
          )}
          <p className="flex items-start gap-2 border-t p-4 text-sm sm:px-5">
            {plan.ready ? (
              <>
                <CircleCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-success"
                />
                Todo listo para importar. Al confirmar se apartan los lugares de
                tu plan; hasta entonces nada cambia en tu inventario.
              </>
            ) : (
              <>
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-warning"
                />
                Todavía no se puede importar: corrige lo marcado y vuelve a
                subir el archivo.
              </>
            )}
          </p>
          {canConfirm && (
            <div className="border-t p-4 sm:px-5">
              <ConfirmImport
                importId={plan.importId}
                products={
                  plan.counts.new + plan.counts.update + plan.counts.reactivate
                }
                places={plan.quota.required}
              />
            </div>
          )}
        </section>
      )}

      {result.preview.length > 0 && (
        <section
          aria-labelledby="entendido"
          className="rounded-xl border bg-card"
        >
          <div className="space-y-1 border-b p-4 sm:px-5">
            <h2 id="entendido" className="font-medium">
              Así se entienden tus filas correctas
            </h2>
            <p className="text-sm text-muted-foreground">
              {result.validRows > result.preview.length
                ? `Las primeras ${result.preview.length} de ${count(result.validRows)}.`
                : "Revisa que unidades, presentaciones y existencias sean lo que esperas."}
            </p>
          </div>
          <ul className="divide-y">
            {result.preview.map((line) => (
              <li key={line.row} className="space-y-1 p-4 sm:px-5">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    Fila {line.row}
                  </span>
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {line.name}
                  </span>
                  <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    {line.sku}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Se controla por {line.unit}
                  {line.presentation && ` · ${line.presentation}`}
                  {line.minimum && ` · mínimo ${line.minimum}`}
                </p>
                <p className="text-sm tabular-nums">
                  {line.stock
                    ? `Existencia inicial: ${line.stock}`
                    : "Sin existencia inicial"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
