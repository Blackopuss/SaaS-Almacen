"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { ProductFormState } from "./actions";

export const EMPTY_PRODUCT: ProductFormState["values"] = {
  sku: "",
  name: "",
  description: "",
  category: "",
  brand: "",
  barcode: "",
};

const FIELD_ORDER = [
  "sku",
  "name",
  "category",
  "brand",
  "barcode",
  "description",
] as const;

/** Card of a product: used to create it and to edit it (INV-02, INV-03). */
export function ProductForm({
  action,
  initial,
  submitLabel,
  categories,
  brands,
}: {
  action: (
    prev: ProductFormState,
    formData: FormData,
  ) => Promise<ProductFormState>;
  initial: ProductFormState["values"];
  submitLabel: string;
  categories: string[];
  brands: string[];
}) {
  const [state, formAction, pending] = useActionState(action, {
    fieldErrors: {},
    values: initial,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  // After a failed submit, move focus to the first field with an error, or
  // to the message when the whole form was refused.
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => state.fieldErrors[field]);
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
    else if (state.formError) alertRef.current?.focus();
  }, [state]);

  const attempt = JSON.stringify(state.values);

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
          id="sku"
          label="Clave (SKU)"
          hint="El código con el que lo identificas. No se repite."
          error={state.fieldErrors.sku}
        >
          {(control) => (
            <Input
              {...control}
              name="sku"
              key={`sku-${attempt}`}
              defaultValue={state.values.sku}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              maxLength={64}
            />
          )}
        </FormField>
        <FormField
          id="barcode"
          label="Código de barras (opcional)"
          hint="Puedes escribirlo o leerlo con el lector."
          error={state.fieldErrors.barcode}
        >
          {(control) => (
            <Input
              {...control}
              name="barcode"
              key={`barcode-${attempt}`}
              defaultValue={state.values.barcode}
              autoComplete="off"
              inputMode="numeric"
              spellCheck={false}
              maxLength={64}
            />
          )}
        </FormField>
      </div>

      <FormField id="name" label="Nombre" error={state.fieldErrors.name}>
        {(control) => (
          <Input
            {...control}
            name="name"
            key={`name-${attempt}`}
            defaultValue={state.values.name}
            autoComplete="off"
            required
            maxLength={160}
          />
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="category"
          label="Categoría (opcional)"
          hint="Elige una o escribe una nueva."
          error={state.fieldErrors.category}
        >
          {(control) => (
            <Input
              {...control}
              name="category"
              key={`category-${attempt}`}
              defaultValue={state.values.category}
              list="categorias"
              autoComplete="off"
              maxLength={80}
            />
          )}
        </FormField>
        <FormField
          id="brand"
          label="Marca (opcional)"
          hint="Elige una o escribe una nueva."
          error={state.fieldErrors.brand}
        >
          {(control) => (
            <Input
              {...control}
              name="brand"
              key={`brand-${attempt}`}
              defaultValue={state.values.brand}
              list="marcas"
              autoComplete="off"
              maxLength={80}
            />
          )}
        </FormField>
      </div>
      <datalist id="categorias">
        {categories.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="marcas">
        {brands.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <FormField
        id="description"
        label="Descripción (opcional)"
        error={state.fieldErrors.description}
      >
        {(control) => (
          <textarea
            {...control}
            name="description"
            key={`description-${attempt}`}
            defaultValue={state.values.description}
            rows={3}
            maxLength={2000}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
          />
        )}
      </FormField>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href="/inventario">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Guardando…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
