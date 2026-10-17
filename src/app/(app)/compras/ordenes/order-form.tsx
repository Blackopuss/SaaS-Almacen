"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import type { OrderFormState } from "./actions";

const areaClass =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

/**
 * Data of a purchase order (CMP-04): who it is for — only when starting
 * it — the day it is expected and its notes. The suppliers are sent by
 * the server.
 */
export function OrderForm({
  action,
  initial,
  suppliers,
  submitLabel,
  cancelHref,
}: {
  action: (prev: OrderFormState, formData: FormData) => Promise<OrderFormState>;
  initial: OrderFormState["values"];
  /** Suppliers to choose from; null when the order already has its own. */
  suppliers: { id: string; name: string }[] | null;
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
    const first = (["supplierId", "expectedOn", "notes"] as const).find(
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
      {suppliers && (
        <FormField
          id="supplierId"
          label="Proveedor"
          hint="A quién le vas a pedir. Después de empezar la orden ya no se cambia."
          error={state.fieldErrors.supplierId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="supplierId"
              // React resets the form after its action: remount with what
              // the person had chosen.
              key={`supplier-${state.answers}`}
              defaultValue={state.values.supplierId}
              required
            >
              <option key="none" value="">
                Elige un proveedor
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}
      <FormField
        id="expectedOn"
        label="¿Cuándo esperas recibirla? (opcional)"
        error={state.fieldErrors.expectedOn}
      >
        {(control) => (
          <Input
            {...control}
            name="expectedOn"
            type="date"
            key={`expected-${state.answers}`}
            defaultValue={state.values.expectedOn}
            className="max-w-xs"
          />
        )}
      </FormField>
      <FormField
        id="notes"
        label="Notas (opcional)"
        hint="Lo que el proveedor o quien reciba deba saber."
        error={state.fieldErrors.notes}
      >
        {(control) => (
          <textarea
            {...control}
            name="notes"
            key={`notes-${state.answers}`}
            defaultValue={state.values.notes}
            rows={3}
            maxLength={500}
            className={areaClass}
          />
        )}
      </FormField>

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
