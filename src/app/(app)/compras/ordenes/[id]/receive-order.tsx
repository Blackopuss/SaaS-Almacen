"use client";

import { CircleAlert, Loader2, PackageCheck } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components";
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
import { NativeSelect } from "@/components/ui/native-select";

import {
  checkReceiptAction,
  receivePurchaseOrderAction,
  type ReceiveFormState,
} from "../actions";

/**
 * Receives everything pending of an order (CMP-07): says what enters,
 * asks where it goes and the supplier's delivery note, and confirms once
 * even if the button is pressed twice or the answer is lost.
 */
export function ReceiveOrder({
  orderId,
  numberText,
  idempotencyKey,
  pending,
  locations,
  defaultLocationId,
}: {
  orderId: string;
  numberText: string;
  /** Created by the server when the page is drawn. */
  idempotencyKey: string;
  /** «Tornillo · 3 cajas»: what will enter, as it was ordered. */
  pending: { id: string; text: string }[];
  locations: { id: string; label: string }[];
  defaultLocationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, busy] = useActionState(
    async (prev: ReceiveFormState, formData: FormData) => {
      let next: ReceiveFormState;
      try {
        next = await receivePurchaseOrderAction(orderId, prev, formData);
      } catch (error) {
        unstable_rethrow(error);
        // No answer arrived: find out whether the receipt was registered
        // before letting the person send it again (INV-22).
        let received = false;
        try {
          received = (
            await checkReceiptAction(String(formData.get("idempotencyKey")))
          ).received;
        } catch {
          received = false;
        }
        next = received
          ? { ...prev, fieldErrors: {}, done: "La recepción quedó registrada." }
          : {
              ...prev,
              fieldErrors: {},
              formError:
                "No pudimos confirmar si se registró: revisa tu conexión y vuelve a intentar. No se recibirá dos veces.",
            };
      }
      if (next.done) {
        toast.success(next.done);
        setOpen(false);
      }
      return { ...next, answers: prev.answers + 1 };
    },
    {
      fieldErrors: {},
      values: { locationId: defaultLocationId, reference: "" },
      answers: 0,
    },
  );
  const { answers } = state;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PackageCheck aria-hidden="true" data-icon="inline-start" />
          Recibir mercancía
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="contents">
          <DialogHeader>
            <DialogTitle>Recibir la orden {numberText}</DialogTitle>
            <DialogDescription>
              Entra al inventario todo lo que falta de esta orden y queda
              recibida. Revisa que llegó completo antes de confirmar.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-3 text-sm">
            {pending.map((line) => (
              <li key={line.id} className="[overflow-wrap:anywhere]">
                {line.text}
              </li>
            ))}
          </ul>
          {state.formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
              <p>{state.formError}</p>
            </div>
          )}
          <FormField
            id={`receive-location-${orderId}`}
            label="¿Dónde lo guardas?"
            error={state.fieldErrors.locationId}
          >
            {(control) => (
              <NativeSelect
                key={`location-${answers}`}
                name="locationId"
                defaultValue={state.values.locationId}
                {...control}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id={`receive-reference-${orderId}`}
            label="Remisión o factura (opcional)"
            hint="El documento con el que llegó la mercancía."
            error={state.fieldErrors.reference}
          >
            {(control) => (
              <Input
                key={`reference-${answers}`}
                name="reference"
                defaultValue={state.values.reference}
                maxLength={80}
                autoComplete="off"
                {...control}
              />
            )}
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Todavía no
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
              {busy ? "Recibiendo…" : "Confirmar recepción"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
