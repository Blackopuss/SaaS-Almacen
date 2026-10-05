import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Zap,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer, PageHeader, ReadOnlyNotice } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib";
import { listLowStock, listRecentMovements } from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import {
  getModuleAccess,
  getPlanOverview,
  usageLevel,
  usagePercent,
} from "@/platform/billing";

export const metadata: Metadata = { title: "Inicio" };

const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

const BAR_COLOR = {
  ok: "bg-primary",
  high: "bg-warning",
  almost: "bg-warning",
  full: "bg-destructive",
} as const;

/** How many of each list fit at a glance. */
const SHOWN = 5;

/**
 * Home (INV-35): what needs attention today — products to restock, what
 * moved last and how much of the plan is in use. Each block appears only
 * for who may see its section; all of it is read from the same services
 * as those sections.
 */
export default async function InicioPage() {
  const access = await getModuleAccess();
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const moduleState = access.moduleState("inventory");
  const inventory = moduleState !== "none";
  const showLow =
    inventory &&
    access.can("inventory.minimum.read") &&
    access.can("inventory.stock.read");
  const showMovements = inventory && access.can("inventory.movement.read");
  const showPlan = access.can("platform.plan.read");

  const [low, movements, plan] = await Promise.all([
    showLow ? listLowStock(actor) : null,
    showMovements ? listRecentMovements(actor, { limit: SHOWN }) : null,
    showPlan ? getPlanOverview(moduleRegistry, actor.organizationId) : null,
  ]);

  const canEnter = access.allows("inventory.entry.create");
  const canExit = access.allows("inventory.exit.create");
  const actions =
    canEnter || canExit ? (
      <>
        {canEnter && (
          <Button asChild>
            <Link href="/movimientos/entrada">
              <ArrowDownToLine aria-hidden="true" data-icon="inline-start" />
              Registrar entrada
            </Link>
          </Button>
        )}
        {canExit && (
          <Button asChild variant="outline">
            <Link href="/movimientos/salida-rapida">
              <Zap aria-hidden="true" data-icon="inline-start" />
              Salida rápida
            </Link>
          </Button>
        )}
      </>
    ) : undefined;
  const nothing = !low && !movements && !plan;
  const products = plan?.products;
  const level = products ? usageLevel(products.used, products.limit) : "ok";

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title={`Hola, ${access.user.name.split(" ")[0]}`}
        description={access.organization.name}
        actions={actions}
      />

      {nothing && (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground sm:p-5">
          Tu cuenta todavía no tiene secciones asignadas en esta empresa. Pide
          al titular o a un administrador que te dé un rol.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {low && (
          <section
            aria-labelledby="inicio-bajos"
            className="rounded-xl border bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 border-b px-4 py-2 sm:px-5">
              <h2
                id="inicio-bajos"
                className="flex items-center gap-2 font-medium"
              >
                Existencias bajas
                {low.total > 0 && (
                  <Badge variant="warning">
                    {low.total.toLocaleString("es-MX")}
                  </Badge>
                )}
              </h2>
              {low.total > 0 && (
                <Link href="/inventario/bajas" className={linkClass}>
                  Ver todas
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              )}
            </div>
            {low.total === 0 ? (
              <p className="flex items-start gap-2 p-4 text-sm text-muted-foreground sm:px-5">
                <CircleCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-success"
                />
                {low.withMinimum === 0
                  ? "Ningún producto tiene mínimo todavía. Escríbelo en la ficha de un producto para que te avise aquí."
                  : "Todo está por encima de su mínimo."}
              </p>
            ) : (
              <ul className="divide-y">
                {low.items.slice(0, SHOWN).map((item) => (
                  <li key={item.productId}>
                    <Link
                      href={`/inventario/${item.productId}`}
                      className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                    >
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">
                        {item.name}
                      </span>
                      <span className="flex items-center gap-2 text-sm tabular-nums">
                        <Badge variant={item.empty ? "destructive" : "warning"}>
                          {item.empty ? "Agotado" : "Bajo"}
                        </Badge>
                        <span className="text-muted-foreground">
                          {item.stockLabel} de {item.minimumLabel}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {products && (
          <section
            aria-labelledby="inicio-cupo"
            className="rounded-xl border bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 border-b px-4 py-2 sm:px-5">
              <h2 id="inicio-cupo" className="font-medium">
                Uso de tu plan
              </h2>
              <Link href="/configuracion/plan" className={linkClass}>
                Mi plan
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
            <div className="space-y-3 p-4 sm:p-5">
              {products.limit === null ? (
                <p className="text-sm text-muted-foreground">
                  Tu empresa todavía no tiene un plan con cupo de productos.
                </p>
              ) : (
                <>
                  <p
                    id="inicio-cupo-productos"
                    className="text-sm text-muted-foreground"
                  >
                    Productos activos
                  </p>
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">
                    {products.used.toLocaleString("es-MX")}{" "}
                    <span className="text-base font-normal text-muted-foreground">
                      de {products.limit.toLocaleString("es-MX")}
                    </span>
                  </p>
                  <div
                    role="progressbar"
                    aria-labelledby="inicio-cupo-productos"
                    aria-valuemin={0}
                    aria-valuemax={products.limit}
                    aria-valuenow={Math.min(products.used, products.limit)}
                    aria-valuetext={`${products.used} de ${products.limit}`}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={`h-full rounded-full ${BAR_COLOR[level]}`}
                      style={{
                        width: `${usagePercent(products.used, products.limit)}%`,
                      }}
                    />
                  </div>
                  {level !== "ok" && (
                    <p className="flex items-start gap-1.5 text-sm">
                      <CircleAlert
                        aria-hidden="true"
                        className={`mt-0.5 size-4 shrink-0 ${level === "full" ? "text-destructive" : "text-warning"}`}
                      />
                      {level === "full"
                        ? "Llegaste al límite de tu plan."
                        : level === "almost"
                          ? "Ya usas más del 90% de tu cupo."
                          : "Ya usas más del 80% de tu cupo."}
                    </p>
                  )}
                </>
              )}
              {plan && (
                <p className="text-sm text-muted-foreground tabular-nums">
                  Personas:{" "}
                  {(
                    plan.seats.members + plan.seats.pendingInvitations
                  ).toLocaleString("es-MX")}
                  {plan.seats.limit !== null &&
                    ` de ${plan.seats.limit.toLocaleString("es-MX")}`}
                </p>
              )}
              {plan?.status === "read_only" && (
                <p className="flex items-start gap-1.5 text-sm">
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                  />
                  Tu plan ya no está vigente: todo queda en solo lectura.
                </p>
              )}
            </div>
          </section>
        )}

        {movements && (
          <section
            aria-labelledby="inicio-movimientos"
            className="rounded-xl border bg-card lg:col-span-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 border-b px-4 py-2 sm:px-5">
              <h2 id="inicio-movimientos" className="font-medium">
                Últimos movimientos
              </h2>
              {movements.length > 0 && (
                <Link href="/movimientos" className={linkClass}>
                  Ver historial
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              )}
            </div>
            {movements.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground sm:px-5">
                Todavía no hay movimientos. Cada entrada, salida o ajuste
                aparecerá aquí.
              </p>
            ) : (
              <ul className="divide-y">
                {movements.map((movement) => {
                  const [first] = movement.lines;
                  return (
                    <li key={movement.id} className="space-y-1 p-4 sm:px-5">
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <Badge variant="secondary">{movement.typeLabel}</Badge>
                        {movement.reversedByMovementId && (
                          <Badge variant="outline">Reversado</Badge>
                        )}
                        <span>
                          <time dateTime={movement.createdAt.toISOString()}>
                            {formatDateTime(movement.createdAt)}
                          </time>
                          {" · "}
                          {movement.authorName ??
                            "Alguien que ya no está en el equipo"}
                        </span>
                      </p>
                      {first && (
                        <p className="flex items-start gap-2 [overflow-wrap:anywhere]">
                          {first.direction === "IN" ? (
                            <ArrowDownToLine
                              aria-hidden="true"
                              className="mt-1 size-4 shrink-0 text-success"
                            />
                          ) : (
                            <ArrowUpFromLine
                              aria-hidden="true"
                              className="mt-1 size-4 shrink-0 text-muted-foreground"
                            />
                          )}
                          <span>
                            <span className="sr-only">
                              {first.direction === "IN"
                                ? "Entran"
                                : "Salen"}{" "}
                            </span>
                            <span className="font-medium tabular-nums">
                              {first.quantity}
                            </span>{" "}
                            de {first.productName}
                            {movement.lines.length > 1 && (
                              <span className="text-muted-foreground">
                                {" "}
                                y{" "}
                                {movement.type === "TRANSFER" &&
                                movement.lines.length === 2
                                  ? `entran a ${movement.lines[1]!.location}`
                                  : movement.lines.length === 2
                                    ? "1 línea más"
                                    : `${movement.lines.length - 1} líneas más`}
                              </span>
                            )}
                          </span>
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </PageContainer>
  );
}
