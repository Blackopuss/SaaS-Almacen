"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { setSalePricesAction, type PricesFormState } from "./actions";

/**
 * Sale prices of a product (VEN-03): its unit and each presentation. An
 * empty presentation sells at its content × the unit price.
 */
export function PricesForm({
  productId,
  rows,
}: {
  productId: string;
  rows: {
    /** "unit" or a presentation id. */
    key: string;
    label: string;
    price: string;
    /** «Sin precio propio se vende a $750.00», for presentations. */
    hint?: string;
  }[];
}) {
  const [state, formAction, pending] = useActionState<
    PricesFormState,
    FormData
  >(setSalePricesAction.bind(null, productId), {
    fieldErrors: {},
    values: Object.fromEntries(rows.map((row) => [row.key, row.price])),
  });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const first = rows.find((row) => state.fieldErrors[row.key]);
    if (first)
      formRef.current
        ?.querySelector<HTMLElement>(`#price-${CSS.escape(first.key)}`)
        ?.focus();
  }, [state, rows]);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="max-w-xl space-y-5"
    >
      {state.formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </div>
      )}
      {rows.map((row) => (
        <FormField
          key={row.key}
          id={`price-${row.key}`}
          label={row.label}
          hint={row.hint}
          error={state.fieldErrors[row.key]}
        >
          {(control) => (
            <Input
              {...control}
              name={row.key === "unit" ? "unit" : `p:${row.key}`}
              inputMode="decimal"
              autoComplete="off"
              defaultValue={state.values[row.key] ?? ""}
              key={`${row.key}-${state.values[row.key] ?? ""}`}
              maxLength={16}
            />
          )}
        </FormField>
      ))}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          Guardar precios
        </Button>
        <Button asChild variant="outline">
          <Link href={`/inventario/${productId}`}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
