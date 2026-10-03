import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components";
import {
  getMfaStatus,
  listActiveSessions,
  requireSession,
} from "@/platform/auth";

import { MfaPanel } from "./mfa-panel";
import { SessionsPanel } from "./sessions-panel";

export const metadata: Metadata = { title: "Configuración" };

export default async function ConfiguracionPage() {
  const { user, sessionId } = await requireSession();
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
