"use client";

import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

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

import { sendPurchaseOrderAction } from "../actions";

/** A delivery as the page hands it over: its dates already as text. */
export type DeliveryRow = {
  id: string;
  recipient: string;
  status: "QUEUED" | "SENT" | "FAILED";
  statusLabel: string;
  /** «10 oct 2026, 9:32 a.m.» in the calendar of the company. */
  requestedText: string;
  endedText: string | null;
  failureReason: string | null;
  attempts?: number;
  maxAttempts?: number;
  retrying?: boolean;
};

/** How often the screen looks again while a delivery is on its way. */
const REFRESH_MS = 3_000;
/** After this long it stops looking by itself; reloading shows the rest. */
const REFRESH_FOR_MS = 12 * 60_000;

/**
 * Deliveries of an order by mail (CMP-06B): the button to send it — or to
 * try again after a failure — and how each request ended. The worker
 * sends the mail, so while one is on its way the screen asks again.
 */
export function DeliveryPanel({
  orderId,
  numberText,
  supplierName,
  deliveries,
  inProgress,
  send,
}: {
  orderId: string;
  numberText: string;
  supplierName: string;
  deliveries: DeliveryRow[];
  inProgress: boolean;
  /** Absent for who may not send orders, or with the module in read-only. */
  send?: { ok: true; recipient: string } | { ok: false; problem: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!inProgress) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > REFRESH_FOR_MS) clearInterval(timer);
      else router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [inProgress, router]);

  const last = deliveries[0];
  const label =
    last?.status === "FAILED"
      ? "Reintentar envío"
      : last
        ? "Enviar otra vez"
        : "Enviar por correo";

  return (
    <section
      aria-labelledby="envio-orden"
      className="max-w-3xl rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-5">
        <h2 id="envio-orden" className="font-medium">
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
                <DialogTitle>
                  ¿Enviar la orden {numberText} por correo?
                </DialogTitle>
                <DialogDescription>
                  {supplierName} la recibirá en{" "}
                  <span className="font-medium [overflow-wrap:anywhere] text-foreground">
                    {send.recipient}
                  </span>
                  , con el PDF adjunto. Si responde, su respuesta te llega a tu
                  correo.
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
                      const result = await sendPurchaseOrderAction(orderId);
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
                  {pending ? "Enviando…" : "Enviar orden"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {send && !send.ok && (
        <p className="border-b p-4 text-sm text-muted-foreground sm:px-5">
          {send.problem}
        </p>
      )}
      <div aria-live="polite">
        {deliveries.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground sm:px-5">
            Esta orden todavía no se ha enviado por correo.
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
