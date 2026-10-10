"use client";

import { Loader2 } from "lucide-react";
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

import { cancelImportAction } from "../../actions";

/** Cancels the import after saying what stays and what goes back (IMP-08B). */
export function CancelImport({
  importId,
  started,
}: {
  importId: string;
  /** It was confirmed: some of its products may already be in the catalog. */
  started: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Cancelar importación</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Cancelar esta importación?</DialogTitle>
          <DialogDescription>
            {started
              ? "Los productos que ya se importaron se quedan en tu catálogo; los que faltan ya no se importarán y los lugares apartados vuelven a tu plan."
              : "No se importará nada de este archivo. Puedes subirlo de nuevo cuando quieras."}{" "}
            Esto no se puede deshacer.
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
              No cancelar
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await cancelImportAction(importId);
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
            {pending ? "Cancelando…" : "Sí, cancelar importación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
