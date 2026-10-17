"use client";

import { Loader2, Undo2 } from "lucide-react";
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

import { reverseMovementAction } from "./actions";

/**
 * Undoes a movement after asking why (INV-25). The key of the confirmation
 * comes from the server with the list, so sending it twice reverses once.
 */
export function ReverseMovement({
  movementId,
  idempotencyKey,
  description,
}: {
  movementId: string;
  idempotencyKey: string;
  /** «Entrada de 120 piezas de Tornillo», read in the dialog. */
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reverse() {
    setError(null);
    startTransition(async () => {
      const result = await reverseMovementAction(
        movementId,
        idempotencyKey,
        reason,
      );
      if (result.ok) {
        toast.success(result.summary);
        setOpen(false);
        setReason("");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" aria-label={`Reversar: ${description}`}>
          <Undo2 aria-hidden="true" data-icon="inline-start" />
          Reversar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Reversar este movimiento?</DialogTitle>
          <DialogDescription>
            {description}. No se borra: se registra un movimiento contrario con
            las mismas cantidades, y ambos quedan en el historial.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            reverse();
          }}
          noValidate
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor={`reverse-reason-${movementId}`}>Motivo</Label>
            <Input
              id={`reverse-reason-${movementId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              autoComplete="off"
              aria-invalid={Boolean(error)}
              aria-describedby={
                error ? `reverse-error-${movementId}` : undefined
              }
              required
            />
            <p className="text-sm text-muted-foreground">
              Obligatorio. Por ejemplo: se capturó en el producto equivocado.
            </p>
          </div>
          {error && (
            <p
              id={`reverse-error-${movementId}`}
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {pending ? "Reversando…" : "Reversar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
