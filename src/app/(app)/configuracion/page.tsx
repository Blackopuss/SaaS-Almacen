import { ChevronRight, History, Users, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer, PageHeader } from "@/components";
import { getMfaStatus, listActiveSessions } from "@/platform/auth";
import { getAccess } from "@/platform/authorization";

import { MfaPanel } from "./mfa-panel";
import { SessionsPanel } from "./sessions-panel";

export const metadata: Metadata = { title: "Configuración" };

export default async function ConfiguracionPage() {
  const access = await getAccess();
  const { user, sessionId } = access;
  const [sessions, mfa] = await Promise.all([
    listActiveSessions(user.id, sessionId),
    getMfaStatus(user.id),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Configuración"
        description="Tu negocio, usuarios, plan y seguridad."
      />
      {(access.can("platform.team.read") ||
        access.can("platform.audit.read")) && (
        <section aria-labelledby="empresa" className="space-y-3">
          <h2 id="empresa" className="text-lg font-semibold">
            Empresa
          </h2>
          {access.can("platform.team.read") && (
            <SettingsLink
              href="/configuracion/equipo"
              icon={Users}
              title="Equipo"
              description="Personas, roles e invitaciones."
            />
          )}
          {access.can("platform.audit.read") && (
            <SettingsLink
              href="/configuracion/bitacora"
              icon={History}
              title="Bitácora"
              description="Quién cambió qué y cuándo."
            />
          )}
        </section>
      )}
      <section aria-labelledby="seguridad" className="space-y-3">
        <h2 id="seguridad" className="text-lg font-semibold">
          Seguridad
        </h2>
        <MfaPanel
          enabled={mfa.enabled}
          required={mfa.required}
          backupCodesLeft={mfa.backupCodesLeft}
        />
        <SessionsPanel
          sessions={sessions.map((s) => ({
            ...s,
            createdAt: s.createdAt.toISOString(),
            lastActiveAt: s.lastActiveAt.toISOString(),
          }))}
        />
      </section>
    </PageContainer>
  );
}

function SettingsLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: "/configuracion/equipo" | "/configuracion/bitacora";
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center gap-3 rounded-xl border bg-card p-4 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-5 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}
