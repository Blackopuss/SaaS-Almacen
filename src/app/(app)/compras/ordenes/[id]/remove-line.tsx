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

import { removeOrderLineAction } from "../actions";

/** Takes a line out of a draft, after asking (CMP-04). */
export function RemoveLine({
  orderId,
  lineId,
  productName,
}: {
  orderId: string;
  lineId: string;
  productName: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`Quitar ${productName} de la orden`}
        >
          <Trash2 aria-hidden="true" data-icon="inline-start" />
          Quitar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Quitar este producto de la orden?</DialogTitle>
          <DialogDescription>
            Se quita {productName} de este borrador. Puedes volver a agregarlo
            después.
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
              No quitar
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await removeOrderLineAction(orderId, lineId);
                if (result.ok) {
                  toast.success("Producto quitado de la orden.");
                  setOpen(false);
                } else {
                  setError(result.error);
                }
              });
            }}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Quitando…" : "Sí, quitar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
