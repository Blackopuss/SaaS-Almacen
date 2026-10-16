import { Mail } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
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
  // The links here open accounts: only on this machine. `npm run dev`
  // listens only on it; with `dev:red` (other devices) the page is still
  // only for an address of this machine.
  const host = ((await headers()).get("host") ?? "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) notFound();
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
              <p className="text-sm text-muted-foreground">
                Para: {m.to}
                {m.replyTo && ` · Responder a: ${m.replyTo}`}
              </p>
              <pre className="mt-3 overflow-x-auto font-sans text-sm whitespace-pre-wrap text-muted-foreground">
                {m.text}
              </pre>
              {m.attachments?.map((file) => (
                <p key={file.name} className="mt-3 text-sm">
                  Adjunto:{" "}
                  <a
                    href={`data:${file.contentType};base64,${file.content}`}
                    download={file.name}
                    className="rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {file.name}
                  </a>{" "}
                  <span className="text-muted-foreground">
                    ({Math.max(1, Math.round(file.size / 1024))} KB)
                  </span>
                </p>
              ))}
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
