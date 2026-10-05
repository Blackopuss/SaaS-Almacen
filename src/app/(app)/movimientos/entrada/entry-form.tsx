"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { registerEntryAction, type EntryFormState } from "../actions";

/** Form of a simple entry (INV-16): where, how much and an optional note. */
export function EntryForm({
  productId,
  unitPlural,
  quantityHint,
  locations,
  defaultLocationId,
}: {
  productId: string;
  /** «piezas», «metros»: the unit the quantity is captured in. */
  unitPlural: string;
  quantityHint: string;
  /** Built in the server: path of the location and what it holds today. */
  locations: { id: string; label: string }[];
  defaultLocationId: string;
}) {
  const [state, formAction, pending] = useActionState(
    registerEntryAction.bind(null, productId),
    {
      fieldErrors: {},
      values: {
        locationId: defaultLocationId,
        quantity: "",
        reference: "",
        reason: "",
      },
    } satisfies EntryFormState,
  );
  const quantityRef = useRef<HTMLInputElement>(null);

  // After a refusal, take the person back to the quantity when it is the problem.
  useEffect(() => {
    if (state.fieldErrors.quantity) quantityRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} noValidate className="max-w-xl space-y-5">
      {state.formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </div>
      )}
      <FormField
        id="quantity"
        label={`¿Cuánto entra? (${unitPlural})`}
        hint={quantityHint}
        error={state.fieldErrors.quantity}
      >
        {(control) => (
          <Input
            {...control}
            ref={quantityRef}
            name="quantity"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values.quantity}
            key={`quantity-${state.values.quantity}`}
            maxLength={20}
            required
            autoFocus
          />
        )}
      </FormField>
      <FormField
        id="locationId"
        label="¿Dónde lo guardas?"
        error={state.fieldErrors.locationId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            name="locationId"
            defaultValue={state.values.locationId}
            key={`location-${state.values.locationId}`}
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
        id="reference"
        label="Referencia (opcional)"
        hint="Remisión, factura o nota con la que llegó."
        error={state.fieldErrors.reference}
      >
        {(control) => (
          <Input
            {...control}
            name="reference"
            autoComplete="off"
            defaultValue={state.values.reference}
            key={`reference-${state.values.reference}`}
            maxLength={120}
          />
        )}
      </FormField>
      <FormField
        id="reason"
        label="Nota (opcional)"
        error={state.fieldErrors.reason}
      >
        {(control) => (
          <Input
            {...control}
            name="reason"
            autoComplete="off"
            defaultValue={state.values.reason}
            key={`reason-${state.values.reason}`}
            maxLength={500}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Registrando…" : "Registrar entrada"}
        </Button>
        <Button asChild variant="outline">
          <Link href="/movimientos">Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
