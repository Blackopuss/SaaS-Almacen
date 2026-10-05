"use client";

import { Loader2, Trash2 } from "lucide-react";
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

import { cancelCountAction, removeCaptureAction } from "../actions";

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
