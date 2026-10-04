import { ChevronLeft, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccessState, PageContainer, PageHeader } from "@/components";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { getAccess } from "@/platform/authorization";
import {
  getPlanOverview,
  usageLevel,
  usagePercent,
  type PlanModule,
} from "@/platform/billing";

export const metadata: Metadata = { title: "Mi plan" };

const LEVEL_TEXT = {
  ok: null,
  high: "Ya usas más del 80% de tu cupo.",
  almost: "Ya usas más del 90% de tu cupo.",
  full: "Llegaste al límite de tu plan. Para agregar más, pide un nivel mayor.",
} as const;

const BAR_COLOR = {
  ok: "bg-primary",
  high: "bg-warning",
  almost: "bg-warning",
  full: "bg-destructive",
} as const;

/** One quota: «84 de 100», a bar and a warning near the limit. */
function Quota({
  id,
  title,
  used,
  limit,
  detail,
}: {
  id: string;
  title: string;
  used: number;
  limit: number | null;
  detail?: string;
}) {
  const level = usageLevel(used, limit);
  const warning = LEVEL_TEXT[level];
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <h3 id={id} className="text-sm font-medium text-muted-foreground">
        {title}
      </h3>
      {limit === null ? (
        <p className="mt-1 font-medium">Sin cupo asignado todavía</p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {used.toLocaleString("es-MX")}{" "}
            <span className="text-base font-normal text-muted-foreground">
              de {limit.toLocaleString("es-MX")}
            </span>
          </p>
          <div
            role="progressbar"
            aria-labelledby={id}
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={Math.min(used, limit)}
            aria-valuetext={`${used} de ${limit}`}
            className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full rounded-full ${BAR_COLOR[level]}`}
              style={{ width: `${usagePercent(used, limit)}%` }}
            />
          </div>
        </>
      )}
      {detail && <p className="mt-2 text-sm text-muted-foreground">{detail}</p>}
      {warning && (
        <p className="mt-2 flex items-start gap-1.5 text-sm">
          <CircleAlert
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 ${level === "full" ? "text-destructive" : "text-warning"}`}
          />
          {warning}
        </p>
      )}
    </div>
  );
}

function moduleNote(module: PlanModule): string {
  if (module.state === "unavailable") return "Próximamente.";
  if (module.state === "available") return "No incluido en tu plan.";
  if (module.validUntil) {
    return `Activo hasta el ${formatDate(module.validUntil)}.`;
  }
  return module.required ? "Base de tu empresa." : "Activo.";
}

/** «Mi plan» (MOD-10): quotas, modules and validity of the company. */
export default async function PlanPage() {
  const access = await getAccess();
  const back = (
    <Link
      href="/configuracion"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Configuración
    </Link>
  );
  if (!access.can("platform.plan.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState
          title="No tienes acceso al plan"
          description="Solo el titular y los administradores pueden ver el plan de la empresa."
        />
      </PageContainer>
    );
  }

  const plan = await getPlanOverview(moduleRegistry, access.organization.id);
  const { products, seats } = plan;
  const pending =
    seats.pendingInvitations === 0
      ? undefined
      : seats.pendingInvitations === 1
        ? "Incluye 1 invitación pendiente."
        : `Incluye ${seats.pendingInvitations} invitaciones pendientes.`;

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Mi plan"
        description="Lo que tu empresa tiene contratado y cuánto está usando."
      />

      {!plan.hasPlan && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border bg-card p-4 text-sm sm:p-5"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <p>
            Tu empresa todavía no tiene un plan activo. Escríbenos para
            activarlo; mientras tanto no se pueden agregar productos ni
            personas.
          </p>
        </div>
      )}

      <section aria-labelledby="vigencia" className="space-y-3">
        <h2 id="vigencia" className="text-lg font-semibold">
          Vigencia
        </h2>
        <p className="rounded-xl border bg-card p-4 font-medium sm:p-5">
          {!plan.hasPlan
            ? "Sin plan activo"
            : plan.validUntil
              ? `Vigente hasta el ${formatDate(plan.validUntil)}`
              : "Sin fecha de término"}
        </p>
      </section>

      <section aria-labelledby="cupos" className="space-y-3">
        <h2 id="cupos" className="text-lg font-semibold">
          Cupos
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Quota
            id="cupo-productos"
            title="Productos activos"
            used={products.used + products.reserved}
            limit={products.limit}
            detail={
              products.reserved > 0
                ? `Incluye ${products.reserved} reservados por una importación en curso.`
                : "Cada producto activo ocupa un lugar; sus piezas, presentaciones y ubicaciones no."
            }
          />
          <Quota
            id="cupo-usuarios"
            title="Usuarios"
            used={seats.members + seats.pendingInvitations}
            limit={seats.limit}
            detail={
              pending ?? "Una persona ocupa un lugar aunque tenga varios roles."
            }
          />
        </div>
      </section>

      <section aria-labelledby="modulos" className="space-y-3">
        <h2 id="modulos" className="text-lg font-semibold">
          Módulos
        </h2>
        <ul className="divide-y rounded-xl border bg-card">
          {plan.modules.map((module) => (
            <li
              key={module.id}
              className="flex flex-wrap items-center justify-between gap-2 p-4 sm:px-5"
            >
              <div className="min-w-0">
                <p className="font-medium">{module.name}</p>
                <p className="text-sm text-muted-foreground">
                  {moduleNote(module)}
                </p>
              </div>
              {module.state === "active" ? (
                <Badge variant="success">Activo</Badge>
              ) : module.state === "available" ? (
                <Badge variant="outline">Disponible</Badge>
              ) : (
                <Badge variant="secondary">Próximamente</Badge>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          Para cambiar de nivel o agregar un módulo, el titular nos lo solicita
          y lo activamos al confirmar el pago.
        </p>
      </section>
    </PageContainer>
  );
}
