import { ChevronLeft, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  EmptyState,
  NoAccessState,
  PageContainer,
  PageHeader,
} from "@/components";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib";
import { listAuditTrail, type AuditTrailEntry } from "@/platform/audit";
import { ROLE_LABELS, getAccess, isRole } from "@/platform/authorization";

export const metadata: Metadata = { title: "Bitácora" };

const PAGE_SIZE = 50;

const roleNames = (roles: string[]) =>
  roles.map((role) => (isRole(role) ? ROLE_LABELS[role] : role)).join(", ");

/** The details of an event in one line: who it was about and what changed. */
function details(entry: AuditTrailEntry): string | null {
  const parts: string[] = [];
  if (entry.targetName) parts.push(entry.targetName);
  if (entry.email) parts.push(entry.email);
  if (entry.rolesFrom.length > 0 && entry.rolesTo.length > 0) {
    parts.push(`${roleNames(entry.rolesFrom)} → ${roleNames(entry.rolesTo)}`);
  } else if (entry.rolesTo.length > 0) {
    parts.push(
      entry.action === "ownership.transferred" ||
        entry.action === "ownership.transfer_offered"
        ? `el titular anterior queda como ${roleNames(entry.rolesTo)}`
        : roleNames(entry.rolesTo),
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Company audit trail (USR-11): titular and administrators only. */
export default async function BitacoraPage({
  searchParams,
}: PageProps<"/configuracion/bitacora">) {
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
  if (!access.can("platform.audit.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState
          title="No tienes acceso a la bitácora"
          description="Solo el titular y los administradores pueden ver el registro de cambios de la empresa."
        />
      </PageContainer>
    );
  }

  const { antes } = await searchParams;
  const parsed = typeof antes === "string" ? new Date(antes) : null;
  const before = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
  // One extra row tells whether there is an older page.
  const rows = await listAuditTrail(access.organization.id, {
    limit: PAGE_SIZE + 1,
    before,
  });
  const entries = rows.slice(0, PAGE_SIZE);
  const older =
    rows.length > PAGE_SIZE ? entries.at(-1)!.createdAt.toISOString() : null;

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Bitácora"
        description="Cambios importantes de la empresa: quién, qué y cuándo. No se puede editar ni borrar."
      />
      {entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="Sin registros en este periodo"
          description="Aquí aparecerán invitaciones, cambios de roles y otros cambios de la empresa."
        />
      ) : (
        <section aria-label="Registros" className="rounded-xl border bg-card">
          <ol className="divide-y">
            {entries.map((entry) => {
              const line = details(entry);
              return (
                <li key={entry.id} className="p-4 sm:px-5">
                  <p className="font-medium">
                    {entry.actorName ?? "Sistema"}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {entry.label.charAt(0).toLowerCase()}
                      {entry.label.slice(1)}
                    </span>
                  </p>
                  {line && (
                    <p className="text-sm [overflow-wrap:anywhere]">{line}</p>
                  )}
                  {entry.reason && (
                    <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      Motivo: {entry.reason}
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">
                    <time dateTime={entry.createdAt.toISOString()}>
                      {formatDateTime(entry.createdAt)}
                    </time>
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {(older || before) && (
        <div className="flex flex-wrap gap-2">
          {before && (
            <Button asChild variant="outline">
              <Link href="/configuracion/bitacora">Ver lo más reciente</Link>
            </Button>
          )}
          {older && (
            <Button asChild variant="outline">
              <Link
                href={`/configuracion/bitacora?antes=${encodeURIComponent(older)}`}
              >
                Ver anteriores
              </Link>
            </Button>
          )}
        </div>
      )}
    </PageContainer>
  );
}
