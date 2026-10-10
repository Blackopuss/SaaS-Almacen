"use client";

import { Loader2, Send } from "lucide-react";
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

import {
  cancelPurchaseOrderAction,
  submitPurchaseOrderAction,
} from "../actions";

const areaClass =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

/** Confirms a draft as sent, after saying what that means (CMP-05). */
export function SubmitOrder({
  orderId,
  numberText,
  supplierName,
  lines,
}: {
  orderId: string;
  numberText: string;
  supplierName: string;
  lines: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Send aria-hidden="true" data-icon="inline-start" />
          Confirmar orden
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Confirmar la orden {numberText}?</DialogTitle>
          <DialogDescription>
            Queda como enviada a {supplierName} con{" "}
            {lines === 1 ? "1 producto" : `${lines} productos`}. Después de
            confirmarla ya no podrás cambiar lo que pide; si algo cambia, se
            cancela y se hace otra.
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
                const result = await submitPurchaseOrderAction(orderId);
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
            {pending ? "Confirmando…" : "Confirmar orden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cancels an order, asking why (CMP-05). */
export function CancelOrder({
  orderId,
  numberText,
  sent,
}: {
  orderId: string;
  numberText: string;
  /** It was already confirmed as sent to the supplier. */
  sent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reasonId = useId();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Cancelar orden</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Cancelar la orden {numberText}?</DialogTitle>
          <DialogDescription>
            {sent ? "Ya estaba enviada: avisa también a tu proveedor. " : ""}
            La orden queda guardada como cancelada, con su motivo; no se borra
            ni se puede reabrir.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor={reasonId} className="text-sm font-medium">
            ¿Por qué se cancela?
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={300}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${reasonId}-error` : undefined}
            className={areaClass}
          />
          {error && (
            <p
              id={`${reasonId}-error`}
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>
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
                const result = await cancelPurchaseOrderAction(orderId, reason);
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
            {pending ? "Cancelando…" : "Sí, cancelar orden"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
