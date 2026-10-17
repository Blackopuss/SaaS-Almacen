"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import type { LinkFormState } from "./actions";

/**
 * How a supplier sells a product (CMP-03): its own code for it and the
 * presentation it is bought in. Used to link and to edit the link. The
 * presentations are those of the product, sent by the server.
 */
export function LinkForm({
  action,
  initial,
  presentations,
  unitName,
  submitLabel,
  cancelHref,
}: {
  action: (prev: LinkFormState, formData: FormData) => Promise<LinkFormState>;
  initial: LinkFormState["values"];
  /** Presentations of the product: «Caja = 100 piezas». */
  presentations: { id: string; label: string }[];
  /** «pieza», «metro»: what it is bought by without a presentation. */
  unitName: string;
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
    const first = (["supplierSku", "presentationId"] as const).find(
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
      <FormField
        id="supplierSku"
        label="Código del proveedor (opcional)"
        hint="Como aparece en su catálogo o en su factura, para pedírselo sin confusiones."
        error={state.fieldErrors.supplierSku}
      >
        {(control) => (
          <Input
            {...control}
            name="supplierSku"
            // React resets the form after its action: remount with what
            // the person had written.
            key={`sku-${state.answers}`}
            defaultValue={state.values.supplierSku}
            maxLength={64}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        )}
      </FormField>
      <FormField
        id="presentationId"
        label="¿Cómo se lo compras?"
        hint="Solo dice cómo viene al comprarlo. El contenido de una presentación se cambia en la ficha del producto, no aquí."
        error={state.fieldErrors.presentationId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            name="presentationId"
            key={`presentation-${state.answers}`}
            defaultValue={state.values.presentationId}
          >
            <option key="unit" value="">
              Por {unitName}
            </option>
            {presentations.map((presentation) => (
              <option key={presentation.id} value={presentation.id}>
                {presentation.label}
              </option>
            ))}
          </NativeSelect>
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
