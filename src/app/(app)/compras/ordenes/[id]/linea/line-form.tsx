"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import type { LineFormState } from "../../actions";

/**
 * A line of a purchase order (CMP-04): how the product is asked for, how
 * much and — for who may record costs — what one of those costs. The
 * choices (the unit and the presentations with their content) are sent
 * by the server; the browser sends back only the choice and what was
 * typed.
 */
export function LineForm({
  action,
  initial,
  captures,
  withCost,
  submitLabel,
  cancelHref,
}: {
  action: (prev: LineFormState, formData: FormData) => Promise<LineFormState>;
  initial: LineFormState["values"];
  /** «Por pieza», «Caja = 100 piezas»: value `base` or `p:<id>`. */
  captures: { value: string; label: string }[];
  /** The person may record costs: the field is shown and sent. */
  withCost: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    fieldErrors: {},
    values: initial,
    answers: 0,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = (["capture", "quantity", "unitCost"] as const).find(
      (field) => state.fieldErrors[field],
    );
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
    else if (state.formError) alertRef.current?.focus();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="max-w-2xl space-y-5 rounded-xl border bg-card p-4 sm:p-6"
    >
      {state.formError && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground outline-none"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="capture"
          label="¿Cómo lo pides?"
          hint="Una presentación se pide completa; su contenido es el del catálogo."
          error={state.fieldErrors.capture}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="capture"
              // React resets the form after its action: remount with what
              // the person had chosen.
              key={`capture-${state.answers}`}
              defaultValue={state.values.capture}
            >
              {captures.map((capture) => (
                <option key={capture.value} value={capture.value}>
                  {capture.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField
          id="quantity"
          label="Cantidad"
          hint="Cuántas de lo que elegiste a la izquierda."
          error={state.fieldErrors.quantity}
        >
          {(control) => (
            <Input
              {...control}
              name="quantity"
              key={`quantity-${state.answers}`}
              defaultValue={state.values.quantity}
              inputMode="decimal"
              autoComplete="off"
              maxLength={20}
              required
            />
          )}
        </FormField>
      </div>
      {withCost && (
        <FormField
          id="unitCost"
          label="Costo de cada una (opcional)"
          hint="En pesos, antes de impuestos, por lo que elegiste arriba: si pides cajas, lo que cuesta una caja. Solo lo ve Compras."
          error={state.fieldErrors.unitCost}
        >
          {(control) => (
            <Input
              {...control}
              name="unitCost"
              key={`cost-${state.answers}`}
              defaultValue={state.values.unitCost}
              inputMode="decimal"
              autoComplete="off"
              maxLength={20}
              className="max-w-xs"
            />
          )}
        </FormField>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Guardando…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
