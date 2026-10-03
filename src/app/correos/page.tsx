import { Mail } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState, PageContainer, PageHeader } from "@/components";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib";
import { listDevOutbox } from "@/platform/email";

export const metadata: Metadata = { title: "Correos de desarrollo" };
export const dynamic = "force-dynamic";

/** Development-only outbox: emails written by the "log" mail driver. */
export default async function CorreosPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const messages = await listDevOutbox();

  return (
    <PageContainer>
      <PageHeader
        title="Correos de desarrollo"
        description="Mensajes que la aplicación habría enviado. Solo existe en tu computadora."
      />
      {messages.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="Sin correos todavía"
          description="Crea una cuenta en /registro y el enlace de confirmación aparecerá aquí."
        />
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{m.subject}</p>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(new Date(m.sentAt))}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">Para: {m.to}</p>
              <pre className="mt-3 overflow-x-auto font-sans text-sm whitespace-pre-wrap text-muted-foreground">
                {m.text}
              </pre>
              {m.actionUrl && (
                <Button asChild size="sm" className="mt-3">
                  <a href={m.actionUrl}>Abrir enlace</a>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
