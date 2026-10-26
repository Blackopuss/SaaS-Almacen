import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  CircleAlert,
  CircleCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer, PageHeader, ReadOnlyNotice } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib";
import {
  getFirstSteps,
  listLowStock,
  listRecentMovements,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import {
  getModuleAccess,
  getPlanOverview,
  usageLevel,
} from "@/platform/billing";

import { FirstStepsGuide } from "./first-steps-guide";

export const metadata: Metadata = { title: "Inicio" };

const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/** How many of each list fit at a glance. */
const SHOWN = 5;

/**
 * Home (INV-35): what needs attention today — products to restock and what
 * moved last. The plan shows up only when it needs attention (KISS). Each
 * block appears only for who may see its section; all of it is read from
 * the same services as those sections.
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
  // The guide of first use (IMP-12) is for a company that can still be
  // set up: with the plan in read-only nothing of it could be done.
  const showGuide =
    moduleState === "active" && access.can("inventory.product.read");

  const [low, movements, plan, firstSteps] = await Promise.all([
    showLow ? listLowStock(actor) : null,
    showMovements ? listRecentMovements(actor, { limit: SHOWN }) : null,
    showPlan ? getPlanOverview(moduleRegistry, actor.organizationId) : null,
    showGuide ? getFirstSteps(actor) : null,
  ]);

  const canEnter = access.allows("inventory.entry.create");
  const canExit = access.allows("inventory.exit.create");
  // With an empty catalog there is nothing to move yet: the guide below
  // says where to start, and these would only lead to an empty search.
  const emptyCatalog = firstSteps !== null && !firstSteps.hasProducts;
  const actions =
    (canEnter || canExit) && !emptyCatalog ? (
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
              <ArrowUpFromLine aria-hidden="true" data-icon="inline-start" />
              Registrar salida
            </Link>
          </Button>
        )}
      </>
    ) : undefined;
  const nothing = !low && !movements && !plan;
  const products = plan?.products;
  const level = products ? usageLevel(products.used, products.limit) : "ok";
  // Day to day the plan is noise: it shows up only when it needs attention.
  const planNotice =
    plan?.status === "read_only"
      ? "Tu plan ya no está vigente: todo queda en solo lectura."
      : products && products.limit !== null && level !== "ok"
        ? level === "full"
          ? `Llegaste al límite de tu plan: ${products.used.toLocaleString("es-MX")} de ${products.limit.toLocaleString("es-MX")} productos.`
          : `Ya usas ${products.used.toLocaleString("es-MX")} de ${products.limit.toLocaleString("es-MX")} productos de tu plan.`
        : null;

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title={`Hola, ${access.user.name.split(" ")[0]}`}
        description={access.organization.name}
        actions={actions}
      />

      {planNotice && (
        <Link
          href="/configuracion/plan"
          className="flex min-h-11 items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm outline-none hover:bg-warning/15 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <CircleAlert
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 ${level === "full" || plan?.status === "read_only" ? "text-destructive" : "text-warning"}`}
          />
          <span className="flex-1">{planNotice}</span>
          <span className="font-medium text-primary">Ver mi plan</span>
        </Link>
      )}

      {nothing && (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground sm:p-5">
          Tu cuenta todavía no tiene secciones asignadas en esta empresa. Pide
          al titular o a un administrador que te dé un rol.
        </p>
      )}

      {firstSteps && !firstSteps.complete && (
        <FirstStepsGuide
          steps={firstSteps}
          can={{
            importProducts: access.allows("inventory.import.create"),
            createProduct: access.allows("inventory.product.create"),
            createLocation: access.allows("inventory.location.create"),
            openingBalance: access.allows("inventory.opening.create"),
            entry: canEnter,
            exit: canExit,
          }}
        />
      )}

      <div className="grid gap-4">
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
                  ? "Pon un mínimo en un producto y aquí te avisamos cuando se esté acabando."
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

        {movements && (
          <section
            aria-labelledby="inicio-movimientos"
            className="rounded-xl border bg-card"
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
                Todavía no hay movimientos.
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
