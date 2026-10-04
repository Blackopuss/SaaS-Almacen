"use client";

import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
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

import { archiveProductAction, reactivateProductAction } from "./actions";

/** Archives a product after confirming (INV-04). On success the action leaves the page. */
export function ArchiveProduct({
  productId,
  name,
}: {
  productId: string;
  name: string;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function archive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveProductAction(productId, reason);
      // A successful archive redirects; only a refusal comes back.
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Archive aria-hidden="true" data-icon="inline-start" />
          Archivar producto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Archivar {name}?</DialogTitle>
          <DialogDescription>
            Deja de aparecer en tu catálogo y libera un lugar de tu plan. No se
            borra: conserva su ficha y su historial, y puedes reactivarlo
            después.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="archive-reason">Motivo (opcional)</Label>
          <Input
            id="archive-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            autoComplete="off"
            aria-describedby={error ? "archive-error" : undefined}
          />
        </div>
        {error && (
          <p
            id="archive-error"
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
          <Button variant="destructive" onClick={archive} disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Archivando…" : "Archivar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Brings an archived product back; it takes a place of the plan again. */
export function ReactivateProduct({
  productId,
  name,
}: {
  productId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  function reactivate() {
    startTransition(async () => {
      const result = await reactivateProductAction(productId);
      if (result.ok) toast.success(`${name} volvió a tu catálogo.`);
      else toast.error(result.error);
    });
  }

  return (
    <Button
      variant="outline"
      onClick={reactivate}
      disabled={pending}
      aria-label={`Reactivar ${name}`}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" />
      ) : (
        <ArchiveRestore aria-hidden="true" data-icon="inline-start" />
      )}
      Reactivar
    </Button>
  );
}
