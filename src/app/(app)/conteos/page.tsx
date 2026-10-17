import { ChevronRight, ClipboardCheck } from "lucide-react";
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
import { formatDateTime } from "@/lib";
import { listCounts, listStockLocations } from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { OpenCountForm } from "./open-count-form";

export const metadata: Metadata = { title: "Conteos" };

/**
 * Physical counts (INV-31): start one for a location and see the ones
 * there are, the open ones first.
 */
export default async function ConteosPage() {
  const access = await getModuleAccess();
  if (!access.can("inventory.count.read")) {
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
  const canOpen =
    access.allows("inventory.count.create") &&
    access.can("inventory.location.read");
  const [counts, locations] = await Promise.all([
    listCounts(actor),
    canOpen ? listStockLocations(actor) : [],
  ]);
  const productsOf = (n: number) =>
    n === 0
      ? "Sin productos contados"
      : n === 1
        ? "1 producto contado"
        : `${n.toLocaleString("es-MX")} productos contados`;

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Conteos"
        description="Compara lo que hay físicamente con el sistema."
      />
      {canOpen && locations.length > 0 && (
        <section
          aria-labelledby="iniciar-conteo"
          className="rounded-xl border bg-card p-4 sm:p-5"
        >
          <h2 id="iniciar-conteo" className="mb-4 font-medium">
            Iniciar un conteo
          </h2>
          <OpenCountForm
            locations={locations.map((location) => ({
              id: location.id,
              path: location.path,
            }))}
          />
        </section>
      )}
      {counts.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Sin conteos"
          description="Inicia un conteo físico para detectar diferencias. Capturar no cambia tus existencias."
        />
      ) : (
        <section
          aria-labelledby="lista-conteos"
          className="rounded-xl border bg-card"
        >
          <h2 id="lista-conteos" className="border-b p-4 font-medium sm:px-5">
            Conteos
          </h2>
          <ul className="divide-y">
            {counts.map((count) => (
              <li key={count.id}>
                <Link
                  href={`/conteos/${count.id}`}
                  className="flex min-h-16 items-center gap-3 p-4 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                >
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium [overflow-wrap:anywhere]">
                        {count.location}
                      </span>
                      <Badge
                        variant={
                          count.status === "OPEN" ? "default" : "secondary"
                        }
                      >
                        {count.statusLabel}
                      </Badge>
                    </span>
                    <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      <time dateTime={count.startedAt.toISOString()}>
                        {formatDateTime(count.startedAt)}
                      </time>
                      {" · "}
                      {count.startedByName ??
                        "Alguien que ya no está en el equipo"}
                      {" · "}
                      {productsOf(count.products)}
                      {count.note && ` · ${count.note}`}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
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
