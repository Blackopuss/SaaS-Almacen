"use client";

import { ClipboardCheck, Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
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

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  applyCountAction,
  cancelCountAction,
  removeCaptureAction,
} from "../actions";

/** Takes back one capture of an open count. */
export function RemoveCapture({
  countId,
  captureId,
  description,
}: {
  countId: string;
  captureId: string;
  /** «2 cajas × 100 = 200 piezas de Tornillo», for screen readers. */
  description: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Quitar captura: ${description}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeCaptureAction(countId, captureId);
          if (!result.ok) toast.error(result.error);
        })
      }
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <Trash2 aria-hidden="true" />
      )}
    </Button>
  );
}

/** Abandons the count after confirming. */
export function CancelCount({ countId }: { countId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Cancelar conteo</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Cancelar este conteo?</DialogTitle>
          <DialogDescription>
            Se cierra sin cambiar tus existencias. Lo capturado queda a la
            vista, pero ya no se podrá continuar ni aplicar.
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
              Seguir contando
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await cancelCountAction(countId);
                if (result.ok) {
                  toast.success(
                    "Conteo cancelado. Tus existencias no cambiaron.",
                  );
                  setOpen(false);
                } else {
                  setError(result.error);
                }
              });
            }}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Cancelando…" : "Cancelar conteo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Applies the count after asking why (INV-33). */
export function ApplyCount({
  countId,
  differences,
}: {
  countId: string;
  /** Products whose stock will be corrected. */
  differences: number;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await applyCountAction(countId, reason);
      if (result.ok) {
        toast.success(result.summary);
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ClipboardCheck aria-hidden="true" data-icon="inline-start" />
          Aplicar conteo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Aplicar este conteo?</DialogTitle>
          <DialogDescription>
            {differences === 0
              ? "Todo coincide: el conteo se cerrará sin cambiar existencias."
              : differences === 1
                ? "Se ajustarán las existencias de 1 producto con su diferencia. Queda como un ajuste en el historial."
                : `Se ajustarán las existencias de ${differences} productos con sus diferencias. Queda como un solo ajuste en el historial.`}{" "}
            Después ya no se podrá capturar más en este conteo.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
          noValidate
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="apply-reason">Motivo</Label>
            <Input
              id="apply-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              autoComplete="off"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "apply-error" : "apply-hint"}
            />
            <p id="apply-hint" className="text-sm text-muted-foreground">
              Obligatorio. Por ejemplo: conteo de cierre de mes.
            </p>
          </div>
          {error && (
            <p
              id="apply-error"
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
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {pending ? "Aplicando…" : "Aplicar conteo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
