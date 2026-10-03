import type { Metadata } from "next";

import { PageContainer, PageHeader } from "@/components";
import { listActiveSessions, requireSession } from "@/platform/auth";

import { SessionsPanel } from "./sessions-panel";

export const metadata: Metadata = { title: "Configuración" };

export default async function ConfiguracionPage() {
  const { user, sessionId } = await requireSession();
  const sessions = await listActiveSessions(user.id, sessionId);

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
