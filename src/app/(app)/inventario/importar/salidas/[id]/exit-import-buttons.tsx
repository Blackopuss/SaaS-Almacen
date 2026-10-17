"use client";

import { Loader2, PackageMinus } from "lucide-react";
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

import {
  cancelExitImportAction,
  confirmExitImportAction,
  type ExitImportActionState,
} from "../actions";

/** A button that asks before doing something to the import, and says how it went. */
function AskFirst({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  dismissLabel,
  destructive,
  run,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  dismissLabel: string;
  destructive?: boolean;
  run: () => Promise<ExitImportActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {dismissLabel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await run();
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
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirms the file after saying what will leave stock (IMP-10). */
export function ConfirmExitImport({
  importId,
  toApply,
  alreadyImported,
}: {
  importId: string;
  /** Rows that will leave stock. */
  toApply: number;
  /** Rows of sales imported before: they will not leave again. */
  alreadyImported: number;
}) {
  const count = (n: number) => n.toLocaleString("es-MX");
  return (
    <AskFirst
      trigger={
        <Button>
          <PackageMinus aria-hidden="true" data-icon="inline-start" />
          Confirmar y descontar
        </Button>
      }
      title="¿Descontar estas salidas de tu inventario?"
      description={`${
        toApply === 1
          ? "Se registrará 1 salida."
          : `Se registrarán ${count(toApply)} salidas.`
      }${
        alreadyImported === 0
          ? ""
          : alreadyImported === 1
            ? " 1 fila ya se había importado y no se descuenta otra vez."
            : ` ${count(alreadyImported)} filas ya se habían importado y no se descuentan otra vez.`
      } Una salida registrada se corrige con una reversa, desde Movimientos.`}
      confirmLabel="Confirmar y descontar"
      pendingLabel="Confirmando…"
      dismissLabel="Todavía no"
      run={() => confirmExitImportAction(importId)}
    />
  );
}

/** Cancels the import: what was registered stays (IMP-10). */
export function CancelExitImport({
  importId,
  started,
}: {
  importId: string;
  /** It was confirmed: some exits may already be registered. */
  started: boolean;
}) {
  return (
    <AskFirst
      trigger={<Button variant="outline">Cancelar importación</Button>}
      title="¿Cancelar esta importación?"
      description={
        started
          ? "Las salidas que ya se registraron se quedan; las que faltan ya no se registrarán. Puedes subir el archivo de nuevo después: lo ya registrado no se repite."
          : "No saldrá nada de tu inventario por este archivo. Puedes subirlo de nuevo cuando quieras."
      }
      confirmLabel="Sí, cancelar importación"
      pendingLabel="Cancelando…"
      dismissLabel="No cancelar"
      destructive
      run={() => cancelExitImportAction(importId)}
    />
  );
}
