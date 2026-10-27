import {
  ChevronRight,
  Gauge,
  History,
  LifeBuoy,
  MapPin,
  Receipt,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageContainer, PageHeader } from "@/components";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib";
import { getMfaStatus, listActiveSessions } from "@/platform/auth";
import { getSupportAccess } from "@/platform/authorization";
import { getModuleAccess } from "@/platform/billing";

import { grantSupportAccessAction, revokeSupportAccessAction } from "./actions";

import { MfaPanel } from "./mfa-panel";
import { SessionsPanel } from "./sessions-panel";

export const metadata: Metadata = { title: "Configuración" };

export default async function ConfiguracionPage() {
  const access = await getModuleAccess();
  const { user, sessionId } = access;
  // Locations are set up once, so they live here and not in the menu.
  const showLocations =
    access.moduleState("inventory") !== "none" &&
    access.can("inventory.location.read");
  const canGrantSupport = access.can("platform.support.grant");
  const showSales =
    access.moduleState("sales") !== "none" &&
    access.can("sales.settings.update");
  const [sessions, mfa, support] = await Promise.all([
    listActiveSessions(user.id, sessionId),
    getMfaStatus(user.id),
    canGrantSupport ? getSupportAccess(access.organization.id) : null,
  ]);

  return (
    <PageContainer>
      <PageHeader title="Configuración" />
      {(showLocations ||
        showSales ||
        access.can("platform.team.read") ||
        access.can("platform.plan.read") ||
        access.can("platform.audit.read")) && (
        <section aria-labelledby="empresa" className="space-y-3">
          <h2 id="empresa" className="text-lg font-semibold">
            Tu negocio
          </h2>
          {showLocations && (
            <SettingsLink
              href="/ubicaciones"
              icon={MapPin}
              title="Ubicaciones"
              description="Zonas, pasillos y estantes."
            />
          )}
          {access.can("platform.team.read") && (
            <SettingsLink
              href="/configuracion/equipo"
              icon={Users}
              title="Equipo"
              description="Personas, roles e invitaciones."
            />
          )}
          {showSales && (
            <SettingsLink
              href="/configuracion/ventas"
              icon={Receipt}
              title="Ventas"
              description="IVA de tus precios."
            />
          )}
          {access.can("platform.plan.read") && (
            <SettingsLink
              href="/configuracion/plan"
              icon={Gauge}
              title="Mi plan"
              description="Cupos, módulos y vigencia."
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
      {support && (
        <section aria-labelledby="soporte" className="space-y-3">
          <h2 id="soporte" className="text-lg font-semibold">
            Soporte
          </h2>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 sm:p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
              <LifeBuoy aria-hidden="true" className="size-5" />
            </span>
            <p className="min-w-0 flex-1 text-sm">
              {support.until ? (
                <>
                  <span className="block font-medium">
                    Soporte puede ver tu empresa hasta el{" "}
                    {formatDateTime(
                      support.until,
                      access.organization.timeZone,
                    )}
                  </span>
                  <span className="block text-muted-foreground">
                    Solo mira, no cambia nada, y queda en la bitácora.
                  </span>
                </>
              ) : (
                <>
                  <span className="block font-medium">
                    ¿Nos pediste ayuda? Permite que soporte vea tu empresa por
                    24 horas.
                  </span>
                  <span className="block text-muted-foreground">
                    Solo mira, no cambia nada, y queda en la bitácora.
                  </span>
                </>
              )}
            </p>
            <form
              action={
                support.until
                  ? revokeSupportAccessAction
                  : grantSupportAccessAction
              }
            >
              <Button type="submit" variant="outline">
                {support.until ? "Quitar acceso" : "Permitir acceso"}
              </Button>
            </form>
          </div>
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
  href:
    | "/ubicaciones"
    | "/configuracion/equipo"
    | "/configuracion/ventas"
    | "/configuracion/plan"
    | "/configuracion/bitacora";
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
