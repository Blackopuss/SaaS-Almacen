"use client";

import { Loader2, Plus } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { PresentationFormState } from "./actions";

/** Presentations of a product and the form to add one (INV-07). */
export function PresentationsPanel({
  action,
  presentations,
  unitPlural,
  canAdd,
}: {
  action: (
    prev: PresentationFormState,
    formData: FormData,
  ) => Promise<PresentationFormState>;
  presentations: { id: string; label: string }[];
  /** Plural name of the product's unit: "piezas", "metros". */
  unitPlural: string;
  canAdd: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {
    fieldErrors: {},
    values: { name: "", factor: "" },
  });
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, move focus to the first field with an error.
  useEffect(() => {
    const first = (["name", "factor"] as const).find(
      (field) => state.fieldErrors[field],
    );
    if (first) {
      formRef.current
        ?.querySelector<HTMLElement>(`#presentation-${first}`)
        ?.focus();
    }
  }, [state]);

  const attempt = JSON.stringify(state.values);

  return (
    <section
      aria-labelledby="presentaciones"
      className="max-w-2xl space-y-4 rounded-xl border bg-card p-4 sm:p-6"
    >
      <div>
        <h2 id="presentaciones" className="font-medium">
          Presentaciones
        </h2>
        <p className="text-sm text-muted-foreground">
          Cómo lo compras o lo manejas además de por {unitPlural}: cajas,
          rollos, sacos. Las existencias se guardan siempre en {unitPlural}.
        </p>
      </div>

      {presentations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este producto todavía no tiene presentaciones.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {presentations.map((presentation) => (
            <li key={presentation.id} className="p-3 font-medium">
              {presentation.label}
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <form
          ref={formRef}
          action={formAction}
          noValidate
          className="space-y-4"
        >
          {state.formError && (
            <p role="alert" className="text-sm text-destructive">
              {state.formError}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="presentation-name"
              label="Nombre de la presentación"
              hint="Por ejemplo: Caja, Rollo, Saco."
              error={state.fieldErrors.name}
            >
              {(control) => (
                <Input
                  {...control}
                  name="name"
                  key={`name-${attempt}`}
                  defaultValue={state.values.name}
                  autoComplete="off"
                  maxLength={40}
                />
              )}
            </FormField>
            <FormField
              id="presentation-factor"
              label={`¿Cuántos ${unitPlural} contiene?`.replace(
                "¿Cuántos",
                unitPlural.endsWith("as") ? "¿Cuántas" : "¿Cuántos",
              )}
              error={state.fieldErrors.factor}
            >
              {(control) => (
                <Input
                  {...control}
                  name="factor"
                  key={`factor-${attempt}`}
                  defaultValue={state.values.factor}
                  inputMode="decimal"
                  autoComplete="off"
                />
              )}
            </FormField>
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" data-icon="inline-start" />
            )}
            {pending ? "Agregando…" : "Agregar presentación"}
          </Button>
        </form>
      )}
    </section>
  );
}
