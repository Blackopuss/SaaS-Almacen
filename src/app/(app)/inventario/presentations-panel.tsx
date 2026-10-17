"use client";

import { Loader2, Plus } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { FactorFormState, PresentationFormState } from "./actions";

/** Presentations of a product and the form to add one (INV-07). */
export function PresentationsPanel({
  action,
  presentations,
  unitPlural,
  canAdd,
  changeAction,
}: {
  action: (
    prev: PresentationFormState,
    formData: FormData,
  ) => Promise<PresentationFormState>;
  presentations: { id: string; label: string; version: number }[];
  /** Plural name of the product's unit: "piezas", "metros". */
  unitPlural: string;
  canAdd: boolean;
  /** Changes the content of one presentation; absent when not allowed. */
  changeAction?: (
    presentationId: string,
    prev: FactorFormState,
    formData: FormData,
  ) => Promise<FactorFormState>;
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
            <li key={presentation.id} className="space-y-2 p-3">
              <p className="font-medium">{presentation.label}</p>
              {changeAction && (
                <ChangeContent
                  key={`${presentation.id}-${presentation.version}`}
                  id={presentation.id}
                  action={changeAction.bind(null, presentation.id)}
                  unitPlural={unitPlural}
                />
              )}
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

/** Disclosure with the form to change what a presentation contains (INV-08). */
function ChangeContent({
  id,
  action,
  unitPlural,
}: {
  id: string;
  action: (
    prev: FactorFormState,
    formData: FormData,
  ) => Promise<FactorFormState>;
  unitPlural: string;
}) {
  const [state, formAction, pending] = useActionState(action, { value: "" });
  const inputId = `factor-${id}`;
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
        Cambiar contenido
      </summary>
      <form action={formAction} noValidate className="mt-2 space-y-3">
        <FormField
          id={inputId}
          label={`Nuevo contenido en ${unitPlural}`}
          hint="Los movimientos ya registrados conservan el contenido anterior."
          error={state.error}
        >
          {(control) => (
            <Input
              {...control}
              name="factor"
              key={`${inputId}-${state.value}`}
              defaultValue={state.value}
              inputMode="decimal"
              autoComplete="off"
              className="sm:max-w-xs"
            />
          )}
        </FormField>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Guardando…" : "Guardar contenido nuevo"}
        </Button>
      </form>
    </details>
  );
}
