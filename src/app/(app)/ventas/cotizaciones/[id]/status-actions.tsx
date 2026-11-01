"use client";

import { Loader2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

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

import { changeQuoteStatusAction } from "../actions";

const areaClass =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

type To = "SENT" | "ACCEPTED" | "REJECTED";

/** One answer with its confirmation; a rejection asks why. */
function Answer({
  quoteId,
  to,
  label,
  title,
  description,
  confirm,
  variant = "outline",
}: {
  quoteId: string;
  to: To;
  label: string;
  title: string;
  description: string;
  confirm: string;
  variant?: "default" | "outline";
}) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant}>{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {to === "REJECTED" && (
          <div className="space-y-2">
            <label htmlFor={reasonId} className="text-sm font-medium">
              ¿Por qué?
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Le pareció caro, compró en otro lado…"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${reasonId}-error` : undefined}
              className={areaClass}
            />
          </div>
        )}
        {error && (
          <p
            id={`${reasonId}-error`}
            role="alert"
            className="text-sm text-destructive"
          >
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
                const result = await changeQuoteStatusAction(
                  quoteId,
                  to,
                  reason,
                );
                if (result.ok) {
                  toast.success(result.message);
                  setOpen(false);
                } else {
                  setError(result.error);
                }
              });
            }}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the customer answered (COT-04): a draft handed over without mail,
 * and a sent quote accepted or rejected. An expired one is only rejected.
 */
export function QuoteStatusActions({
  quoteId,
  number,
  status,
  validUntil,
}: {
  quoteId: string;
  number: number;
  status: "DRAFT" | "SENT" | "EXPIRED";
  validUntil: string;
}) {
  if (status === "DRAFT") {
    return (
      <Answer
        quoteId={quoteId}
        to="SENT"
        label="Marcar como enviada"
        title={`¿La cotización ${number} ya está en manos del cliente?`}
        description="Úsalo si se la entregaste en persona o por WhatsApp. Ya enviada, no se podrá cambiar."
        confirm="Marcar como enviada"
      />
    );
  }
  return (
    <section
      aria-labelledby="respuesta-cliente"
      className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
    >
      <h2 id="respuesta-cliente" className="font-medium">
        Respuesta del cliente
      </h2>
      {status === "EXPIRED" && (
        <p className="text-sm text-muted-foreground">
          Venció el {validUntil}: ya no se puede aceptar. Si la quiere, haz una
          nueva con los precios de hoy.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "SENT" && (
          <Answer
            quoteId={quoteId}
            to="ACCEPTED"
            label="Marcar aceptada"
            title={`¿El cliente aceptó la cotización ${number}?`}
            description="Queda como aceptada con sus precios. Ya no se podrá cambiar."
            confirm="Marcar aceptada"
            variant="default"
          />
        )}
        <Answer
          quoteId={quoteId}
          to="REJECTED"
          label="Marcar rechazada"
          title={`¿El cliente rechazó la cotización ${number}?`}
          description="Queda como rechazada, con el motivo. Ya no se podrá cambiar."
          confirm="Marcar rechazada"
        />
      </div>
    </section>
  );
}
