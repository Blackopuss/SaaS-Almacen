"use client";

import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { sendQuoteAction, setQuoteCustomerEmailAction } from "../actions";

/** A delivery as the page hands it over: its dates already as text. */
export type QuoteDeliveryRow = {
  id: string;
  recipient: string;
  status: "QUEUED" | "SENT" | "FAILED";
  statusLabel: string;
  requestedText: string;
  endedText: string | null;
  failureReason: string | null;
  attempts?: number;
  maxAttempts?: number;
  retrying?: boolean;
};

const REFRESH_MS = 3_000;
const REFRESH_FOR_MS = 12 * 60_000;

/**
 * Mails of a quote (COT-03): the button to send it to the customer — or to
 * try again — and how each request ended. Without a mail in the
 * customer's card, it can be written here first. The worker sends the
 * mail, so while one is on its way the screen asks again.
 */
export function QuoteDeliveryPanel({
  quoteId,
  number,
  customerName,
  draft,
  deliveries,
  inProgress,
  send,
  canWriteEmail,
}: {
  quoteId: string;
  number: number;
  customerName: string;
  /** Sending it closes the draft. */
  draft: boolean;
  deliveries: QuoteDeliveryRow[];
  inProgress: boolean;
  send?:
    | { ok: true; recipient: string }
    | { ok: false; problem: string; missingEmail?: { customerId: string } };
  canWriteEmail: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!inProgress) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > REFRESH_FOR_MS) clearInterval(timer);
      else router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [inProgress, router]);

  async function saveEmail() {
    setSaving(true);
    setEmailError(null);
    try {
      const result = await setQuoteCustomerEmailAction(quoteId, email);
      if (result.ok) {
        toast.success(result.message);
        setEmail("");
        router.refresh();
      } else {
        setEmailError(result.error);
      }
    } catch {
      setEmailError("No pudimos guardarlo. Revisa tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  const last = deliveries[0];
  const label =
    last?.status === "FAILED"
      ? "Reintentar envío"
      : last
        ? "Enviar otra vez"
        : "Enviar al cliente";

  return (
    <section
      aria-labelledby="envio-cotizacion"
      className="rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-5">
        <h2 id="envio-cotizacion" className="font-medium">
          Envío por correo
        </h2>
        {send?.ok && !inProgress && (
          <Dialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              if (next) setError(null);
            }}
          >
            <DialogTrigger asChild>
              <Button
                variant={last?.status === "FAILED" ? "default" : "outline"}
              >
                <Mail aria-hidden="true" data-icon="inline-start" />
                {label}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>¿Enviar la cotización {number}?</DialogTitle>
                <DialogDescription>
                  {customerName} la recibirá en{" "}
                  <span className="font-medium [overflow-wrap:anywhere] text-foreground">
                    {send.recipient}
                  </span>
                  , con el PDF adjunto. Si responde, su respuesta te llega a tu
                  correo.
                  {draft && " Ya enviada, no se podrá cambiar."}
                </DialogDescription>
              </DialogHeader>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Todavía no
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await sendQuoteAction(quoteId);
                      if (result.ok) {
                        toast.success(result.message);
                        setOpen(false);
                      } else {
                        setError(result.error);
                      }
                    });
                  }}
                >
                  {pending && (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  )}
                  {pending ? "Enviando…" : "Enviar cotización"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {send && !send.ok && (
        <div className="space-y-3 border-b p-4 text-sm sm:px-5">
          <p className="text-muted-foreground">{send.problem}</p>
          {send.missingEmail && canWriteEmail && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 flex-1">
                <FormField
                  id="correo-cliente"
                  label={`Correo de ${customerName}`}
                  error={emailError ?? undefined}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveEmail();
                        }
                      }}
                      autoComplete="off"
                      maxLength={254}
                      placeholder="nombre@empresa.com"
                    />
                  )}
                </FormField>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => void saveEmail()}
              >
                {saving && (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                )}
                Guardar correo
              </Button>
            </div>
          )}
        </div>
      )}
      <div aria-live="polite">
        {deliveries.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground sm:px-5">
            Esta cotización todavía no se ha enviado por correo.
          </p>
        ) : (
          <ol className="divide-y">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="space-y-1 p-4 sm:px-5">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      delivery.status === "SENT"
                        ? "default"
                        : delivery.status === "FAILED"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {delivery.status === "QUEUED" && (
                      <Loader2
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none"
                      />
                    )}
                    {delivery.statusLabel}
                  </Badge>
                  <span className="[overflow-wrap:anywhere]">
                    a {delivery.recipient}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {delivery.status === "SENT"
                    ? `Salió el ${delivery.endedText}`
                    : delivery.status === "FAILED"
                      ? `Se pidió el ${delivery.requestedText}`
                      : delivery.retrying
                        ? `No salió en el intento ${delivery.attempts} de ${delivery.maxAttempts}. Se vuelve a intentar solo en unos minutos.`
                        : `Sale en unos segundos. Se pidió el ${delivery.requestedText}`}
                </p>
                {delivery.status === "FAILED" && (
                  <p className="text-sm text-destructive">
                    {delivery.failureReason}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
