import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  CircleCheck,
  ClipboardList,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

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
import { formatDateTime } from "@/lib";
import { listRecentMovements } from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Movimientos" };

/** Latest stock movements (INV-16). History with filters arrives with INV-27. */
export default async function MovimientosPage({
  searchParams,
}: PageProps<"/movimientos">) {
  const access = await getModuleAccess();
  if (!access.can("inventory.movement.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState === "none") {
    return (
      <PageContainer>
        <NoModuleState module="Inventario" />
      </PageContainer>
    );
  }
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const { registrado } = await searchParams;
  const [movements, registered] = await Promise.all([
    listRecentMovements(actor, { limit: 30 }),
    // The notice is built from the stored movement, never from the address.
    typeof registrado === "string" && registrado
      ? listRecentMovements(actor, { movementId: registrado.slice(0, 36) })
      : [],
  ]);
  const justRegistered = registered[0];
  // Shown only to who may register entries, and only while the plan allows it.
  const entryButton = access.allows("inventory.entry.create") ? (
    <Button asChild>
      <Link href="/movimientos/entrada">
        <ArrowDownToLine aria-hidden="true" data-icon="inline-start" />
        Registrar entrada
      </Link>
    </Button>
  ) : undefined;
  const exitButton = access.allows("inventory.exit.create") ? (
    <Button asChild variant="outline">
      <Link href="/movimientos/salida">
        <ArrowUpFromLine aria-hidden="true" data-icon="inline-start" />
        Registrar salida
      </Link>
    </Button>
  ) : undefined;
  const openingButton = access.allows("inventory.opening.create") ? (
    <Button asChild variant="outline">
      <Link href="/movimientos/saldo-inicial">
        <ClipboardList aria-hidden="true" data-icon="inline-start" />
        Saldo inicial
      </Link>
    </Button>
  ) : undefined;
  const actions =
    entryButton || exitButton || openingButton ? (
      <>
        {entryButton}
        {exitButton}
        {openingButton}
      </>
    ) : undefined;

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Movimientos"
        description="Entradas, salidas, reubicaciones y ajustes."
        actions={actions}
      />
      {justRegistered && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <p>
            {justRegistered.typeLabel} registrada:{" "}
            {justRegistered.lines.map((line, index) => (
              <span key={index}>
                {index > 0 && "; "}
                <span className="font-medium">{line.quantity}</span> de{" "}
                {line.productName} en {line.location}
              </span>
            ))}
            .
          </p>
        </div>
      )}
      {movements.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Sin movimientos registrados"
          description="Cada entrada, salida o reubicación aparecerá aquí con su autor y motivo."
          action={
            actions && <div className="flex flex-wrap gap-2">{actions}</div>
          }
        />
      ) : (
        <section
          aria-labelledby="ultimos-movimientos"
          className="rounded-xl border bg-card"
        >
          <h2
            id="ultimos-movimientos"
            className="border-b p-4 font-medium sm:px-5"
          >
            Últimos movimientos
          </h2>
          <ul className="divide-y">
            {movements.map((movement) => (
              <li key={movement.id} className="space-y-2 p-4 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant="secondary">{movement.typeLabel}</Badge>
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={movement.createdAt.toISOString()}>
                      {formatDateTime(movement.createdAt)}
                    </time>
                    {" · "}
                    {movement.authorName ??
                      "Alguien que ya no está en el equipo"}
                  </p>
                </div>
                <ul className="space-y-1">
                  {movement.lines.map((line, index) => (
                    <li key={index} className="flex items-start gap-2">
                      {line.direction === "IN" ? (
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
                      <p className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="sr-only">
                          {line.direction === "IN" ? "Entran" : "Salen"}{" "}
                        </span>
                        <span className="font-medium tabular-nums">
                          {line.quantity}
                        </span>{" "}
                        {line.captured && (
                          <span className="text-muted-foreground">
                            ({line.captured}){" "}
                          </span>
                        )}
                        de {line.productName}{" "}
                        <span className="text-muted-foreground">
                          ({line.sku}) · {line.location}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
                {(movement.reference || movement.reason) && (
                  <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    {[
                      movement.reference && `Referencia: ${movement.reference}`,
                      movement.reason,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
