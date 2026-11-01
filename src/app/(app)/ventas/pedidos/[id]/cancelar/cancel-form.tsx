"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { cancelOrderAction, type CancelOrderState } from "./actions";

/** Why the order is cancelled; nothing else to choose. */
export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState(
    (prev: CancelOrderState, formData: FormData) =>
      cancelOrderAction(orderId, prev, formData),
    { reason: "", answers: 0 },
  );
  return (
    <form
      action={formAction}
      noValidate
      className="max-w-xl space-y-5 rounded-xl border bg-card p-4 sm:p-5"
    >
      <FormField id="cancelar-motivo" label="Motivo" error={state.error}>
        {(control) => (
          <Input
            {...control}
            name="reason"
            autoComplete="off"
            maxLength={500}
            placeholder="El cliente ya no lo necesita"
            defaultValue={state.reason}
            key={`reason-${state.answers}`}
            autoFocus={state.answers > 0}
          />
        )}
      </FormField>
      <Button type="submit" variant="destructive" disabled={pending}>
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        Cancelar pedido
      </Button>
    </form>
  );
}
