import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ShoppingCart,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccessState, PageContainer, PageHeader } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { getAccess } from "@/platform/authorization";
import {
  formatMxn,
  getPlanOverview,
  listOrders,
  orderPath,
  usageLevel,
  usagePercent,
  type PlanModule,
} from "@/platform/billing";

import { ORDER_STATUS } from "./order-status";

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
  if (module.state === "read_only") {
    return "Solo lectura: puedes consultar y exportar su información.";
  }
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
  // Only the titular buys the plan, for the whole team (ADR 0028).
  const buyer = access.can("platform.subscription.create");
  const orders = buyer
    ? await listOrders({
        organizationId: access.organization.id,
        userId: access.user.id,
      })
    : [];
  const renewHint = buyer
    ? "Renuévalo en «Comprar o renovar»."
    : "El titular puede renovarlo.";
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
        actions={
          buyer ? (
            <Button asChild>
              <Link href="/configuracion/plan/comprar">
                <ShoppingCart aria-hidden="true" data-icon="inline-start" />
                Comprar o renovar
              </Link>
            </Button>
          ) : undefined
        }
      />
      {!buyer && (
        <p className="text-sm text-muted-foreground">
          El plan es de toda la empresa: lo compra el titular y todo el equipo
          usa el mismo plan.
        </p>
      )}

      {plan.status === "read_only" && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border bg-card p-4 text-sm sm:p-5"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <p>
            <span className="font-medium">Tu plan ya no está vigente.</span> Tu
            información sigue intacta: puedes consultarla y exportarla, pero no
            registrar cambios. {renewHint}
          </p>
        </div>
      )}
      {plan.paymentNotice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border bg-card p-4 text-sm sm:p-5"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <p>
            Tenemos un pago pendiente de tu plan. Todo sigue funcionando; ponte
            al corriente para evitar que pase a solo lectura.
          </p>
        </div>
      )}
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
            Tu empresa todavía no tiene un plan activo; mientras tanto no se
            pueden agregar productos ni personas.{" "}
            {buyer
              ? "Cómpralo en «Comprar o renovar»."
              : "El titular puede comprarlo."}
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
            : plan.status === "read_only"
              ? "Venció: solo lectura y exportación"
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
              ) : module.state === "read_only" ? (
                <Badge variant="warning">Solo lectura</Badge>
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

      {buyer && orders.length > 0 && (
        <section aria-labelledby="compras" className="space-y-3">
          <h2 id="compras" className="text-lg font-semibold">
            Compras
          </h2>
          <ul className="divide-y rounded-xl border bg-card">
            {orders.slice(0, 10).map((order) => (
              <li key={order.id}>
                <Link
                  href={orderPath(order.id)}
                  className="flex min-h-11 items-center gap-3 p-4 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-medium">
                        {order.transactionId}
                      </span>
                      <Badge variant={ORDER_STATUS[order.status].variant}>
                        {ORDER_STATUS[order.status].label}
                      </Badge>
                    </span>
                    <span className="block text-sm text-muted-foreground tabular-nums">
                      {order.planText} · {order.months}{" "}
                      {order.months === 1 ? "mes" : "meses"} ·{" "}
                      {formatMxn(order.total)} ·{" "}
                      {formatDateTime(
                        order.createdAt,
                        access.organization.timeZone,
                      )}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
