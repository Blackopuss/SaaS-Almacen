"use client";

import { Loader2, PackageCheck } from "lucide-react";
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

import { confirmImportAction } from "../../actions";

/** Confirms the import after saying what it will take (IMP-07). */
export function ConfirmImport({
  importId,
  products,
  places,
}: {
  importId: string;
  /** Products of the file. */
  products: number;
  /** Places of the plan it will hold. */
  places: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PackageCheck aria-hidden="true" data-icon="inline-start" />
          Confirmar importación
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Confirmar esta importación?</DialogTitle>
          <DialogDescription>
            {products === 1
              ? "Se importará 1 producto."
              : `Se importarán ${products.toLocaleString("es-MX")} productos.`}{" "}
            {places === 0
              ? "No ocupa lugares nuevos de tu plan."
              : places === 1
                ? "Se apartará 1 lugar de tu plan."
                : `Se apartarán ${places.toLocaleString("es-MX")} lugares de tu plan.`}{" "}
            Después de confirmar ya no podrás cambiar sus columnas.
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
                const result = await confirmImportAction(importId);
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
            {pending ? "Confirmando…" : "Confirmar importación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
