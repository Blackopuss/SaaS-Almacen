import { ChevronLeft, CircleAlert, ClipboardCheck } from "lucide-react";
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
import { formatDateTime } from "@/lib";
import { getCount } from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { CaptureForm } from "./capture-form";
import { ApplyCount, CancelCount, RemoveCapture } from "./count-controls";

export const metadata: Metadata = { title: "Conteo" };

/**
 * One physical count (INV-31): capture what is found and see it next to
 * what the system had when each product was counted. Nothing here changes
 * stock.
 */
export default async function ConteoPage({
  params,
}: PageProps<"/conteos/[id]">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/conteos"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Conteos
    </Link>
  );
  if (!access.can("inventory.count.read")) {
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
  const count = await getCount(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!count) notFound();

  const open = count.status === "OPEN";
  const canCapture =
    open &&
    moduleState === "active" &&
    access.allows("inventory.count.update") &&
    access.can("inventory.product.read");
  // Applying writes adjustments: it takes both permissions (INV-33).
  const canApply =
    open &&
    moduleState === "active" &&
    count.lines.length > 0 &&
    count.conflicts === 0 &&
    access.allows("inventory.count.apply") &&
    access.allows("inventory.adjustment.create");
  const person = (name: string | null) =>
    name ?? "alguien que ya no está en el equipo";

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title={`Conteo de ${count.location}`}
        description={count.note ?? undefined}
        actions={
          canCapture || canApply ? (
            <>
              {canApply && (
                <ApplyCount
                  countId={count.id}
                  differences={count.differences}
                />
              )}
              {canCapture && <CancelCount countId={count.id} />}
            </>
          ) : undefined
        }
      />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <Badge variant={open ? "default" : "secondary"}>
          {count.statusLabel}
        </Badge>
        <span>
          Iniciado el{" "}
          <time dateTime={count.startedAt.toISOString()}>
            {formatDateTime(count.startedAt)}
          </time>{" "}
          por {person(count.startedByName)}
        </span>
        {count.closedAt && (
          <span>
            · Cerrado el{" "}
            <time dateTime={count.closedAt.toISOString()}>
              {formatDateTime(count.closedAt)}
            </time>{" "}
            por {person(count.closedByName)}
          </span>
        )}
      </p>

      {count.status === "APPLIED" && (
        <p className="text-sm">
          {count.appliedMovementId ? (
            <>
              Sus diferencias se aplicaron como un ajuste.{" "}
              <Link
                href={`/movimientos?registrado=${count.appliedMovementId}`}
                className="inline-flex min-h-11 items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Ver el ajuste en Movimientos
              </Link>
            </>
          ) : (
            "Todo coincidía: se cerró sin ajustar existencias."
          )}
        </p>
      )}
      {count.conflicts > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <p>
            {count.conflicts === 1
              ? "Un producto se movió después de contarlo más de lo que el conteo permite"
              : `${count.conflicts} productos se movieron después de contarlos más de lo que el conteo permite`}
            : hay que volver a contar {count.conflicts === 1 ? "ese" : "esos"}{" "}
            antes de aplicar. Están marcados abajo.
          </p>
        </div>
      )}

      {canCapture && <CaptureForm countId={count.id} />}

      <section aria-labelledby="contado" className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
          <h2 id="contado" className="font-medium">
            Lo contado
          </h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            {count.products === 0
              ? "Sin productos"
              : `${count.products === 1 ? "1 producto" : `${count.products.toLocaleString("es-MX")} productos`} · ${
                  count.differences === 0
                    ? "sin diferencias"
                    : count.differences === 1
                      ? "1 con diferencia"
                      : `${count.differences.toLocaleString("es-MX")} con diferencia`
                }${
                  count.movedAfter === 0
                    ? ""
                    : count.movedAfter === 1
                      ? " · 1 con movimientos posteriores"
                      : ` · ${count.movedAfter.toLocaleString("es-MX")} con movimientos posteriores`
                }`}
          </p>
        </div>
        {count.lines.length === 0 ? (
          <div className="flex items-start gap-3 p-4 text-sm text-muted-foreground sm:px-5">
            <ClipboardCheck aria-hidden="true" className="size-5 shrink-0" />
            <p>
              {open
                ? "Busca o escanea el primer producto y escribe cuántos hay. Puedes capturar cajas y piezas por separado: se suman en la unidad del producto."
                : "Este conteo se cerró sin capturas."}
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {count.lines.map((line) => (
              <li key={line.lineId} className="space-y-2 p-4 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0">
                    <span className="font-medium [overflow-wrap:anywhere]">
                      {line.name}
                    </span>{" "}
                    <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {line.sku}
                    </span>
                  </p>
                  <p className="font-medium tabular-nums">
                    Contado: {line.countedLabel}
                  </p>
                </div>
                <ul className="space-y-1">
                  {line.captures.map((capture) => (
                    <li
                      key={capture.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere] tabular-nums">
                        {capture.label}
                      </span>
                      {canCapture && (
                        <RemoveCapture
                          countId={count.id}
                          captureId={capture.id}
                          description={`${capture.label} de ${line.name}`}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                {line.mixed && (
                  <p className="flex items-start gap-1.5 text-sm">
                    <CircleAlert
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-warning"
                    />
                    Hay empaques y sueltos capturados: revisa que lo de los
                    empaques no se haya contado otra vez como sueltos.
                  </p>
                )}
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span className="tabular-nums">
                    El sistema tenía {line.systemLabel} al contarlo (
                    <time dateTime={line.countedAt.toISOString()}>
                      {formatDateTime(line.countedAt)}
                    </time>
                    )
                  </span>
                  <Badge
                    variant={line.difference === "0" ? "secondary" : "warning"}
                  >
                    {line.differenceLabel}
                  </Badge>
                </p>
                {line.since &&
                  (line.since.movedLabel || line.since.conflict) && (
                    <div className="space-y-1 rounded-lg border bg-muted/50 p-3 text-sm">
                      {line.since.movedLabel && (
                        <p className="font-medium">
                          {line.since.movedLabel}
                          {line.since.movementCount > 0 &&
                            ` (${line.since.movementCount === 1 ? "1 movimiento" : `${line.since.movementCount} movimientos`})`}
                          .
                        </p>
                      )}
                      {line.since.movements.length > 0 && (
                        <ul className="text-muted-foreground">
                          {line.since.movements.map((movement, index) => (
                            <li key={index} className="tabular-nums">
                              {movement.typeLabel} · {movement.quantity} ·{" "}
                              <time dateTime={movement.createdAt.toISOString()}>
                                {formatDateTime(movement.createdAt)}
                              </time>
                            </li>
                          ))}
                          {line.since.movementCount >
                            line.since.movements.length && (
                            <li>
                              <Link
                                href={`/movimientos?producto=${line.productId}`}
                                className="inline-flex min-h-11 items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                              >
                                Ver todos en el historial
                              </Link>
                            </li>
                          )}
                        </ul>
                      )}
                      {line.since.conflict ? (
                        <p className="flex items-start gap-1.5">
                          <CircleAlert
                            aria-hidden="true"
                            className="mt-0.5 size-4 shrink-0 text-destructive"
                          />
                          Hoy el sistema tiene {line.since.currentLabel} y la
                          diferencia no cabe: salió más de lo que se contó.
                          Quita sus capturas y cuéntalo de nuevo.
                        </p>
                      ) : (
                        <p className="tabular-nums">
                          Hoy el sistema tiene {line.since.currentLabel}. Al
                          aplicar la diferencia quedarían{" "}
                          <span className="font-medium">
                            {line.since.targetLabel}
                          </span>
                          .
                        </p>
                      )}
                    </div>
                  )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && count.lines.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Capturar no cambia tus existencias. Cada diferencia se compara con lo
          que el sistema tenía al contar ese producto; lo que se mueva después
          se respeta y se muestra aquí. Al terminar, «Aplicar conteo» registra
          las diferencias como un ajuste.
        </p>
      )}
    </PageContainer>
  );
}
