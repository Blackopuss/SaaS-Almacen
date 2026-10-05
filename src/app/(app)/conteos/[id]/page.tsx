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
import { CancelCount, RemoveCapture } from "./count-controls";

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
  const person = (name: string | null) =>
    name ?? "alguien que ya no está en el equipo";

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title={`Conteo de ${count.location}`}
        description={count.note ?? undefined}
        actions={canCapture ? <CancelCount countId={count.id} /> : undefined}
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
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && count.lines.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Capturar no cambia tus existencias. Las diferencias se aplicarán como
          ajustes en un paso aparte, después de revisar lo que se haya movido
          mientras contabas.
        </p>
      )}
    </PageContainer>
  );
}
