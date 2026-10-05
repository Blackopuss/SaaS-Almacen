"use client";

import { CircleCheck, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { setMinimumAction, type MinimumFormState } from "./actions";

/**
 * Minimum of a product (INV-30): the quantity at which it should be bought
 * again. Empty = no minimum.
 */
export function MinimumForm({
  productId,
  minimum,
  unit,
}: {
  productId: string;
  /** Stored minimum in the product's unit, or "" when it has none. */
  minimum: string;
  /** «piezas», «metros». */
  unit: string;
}) {
  const [state, formAction, pending] = useActionState(
    setMinimumAction.bind(null, productId),
    { value: minimum } satisfies MinimumFormState,
  );
  return (
    <form action={formAction} noValidate className="space-y-2">
      <FormField
        id="minimum"
        label={`Mínimo (${unit})`}
        hint="Cuando haya esta cantidad o menos, el producto aparece en «Existencias bajas». Déjalo vacío para no avisar."
        error={state.error}
      >
        {(control) => (
          <div className="flex max-w-xs items-center gap-2">
            <Input
              {...control}
              name="minimum"
              inputMode="decimal"
              autoComplete="off"
              maxLength={40}
              defaultValue={state.value}
              // React resets the form after its action: show what stayed.
              key={`${state.value}-${state.saved ?? ""}`}
              className="tabular-nums"
            />
            <Button type="submit" variant="outline" disabled={pending}>
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              Guardar
            </Button>
          </div>
        )}
      </FormField>
      <p role="status" className="min-h-5 text-sm text-muted-foreground">
        {state.saved && !pending && (
          <span className="inline-flex items-start gap-1.5">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-success"
            />
            {state.saved}
          </span>
        )}
      </p>
    </form>
  );
}
