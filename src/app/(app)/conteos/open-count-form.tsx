"use client";

import { ClipboardCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { openCountAction, type OpenCountState } from "./actions";

/** Starts a count: which location, and an optional note (INV-31). */
export function OpenCountForm({
  locations,
}: {
  /** Active locations, «General» first. */
  locations: { id: string; path: string }[];
}) {
  const [state, formAction, pending] = useActionState(openCountAction, {
    values: { locationId: locations[0]?.id ?? "", note: "" },
  } satisfies OpenCountState);
  return (
    <form action={formAction} noValidate className="max-w-xl space-y-4">
      <FormField
        id="locationId"
        label="¿Qué ubicación vas a contar?"
        hint="Se cuenta una ubicación a la vez. Puedes tener conteos abiertos en ubicaciones distintas."
        error={state.error}
      >
        {(control) => (
          <NativeSelect
            {...control}
            name="locationId"
            defaultValue={state.values.locationId}
            // React resets the form after its action: keep what was chosen.
            key={`${state.values.locationId}-${state.error ?? ""}`}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.path}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {state.openCountId && (
        <p className="text-sm">
          <Link
            href={`/conteos/${state.openCountId}`}
            className="inline-flex min-h-11 items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Continuar el conteo abierto
          </Link>
        </p>
      )}
      <FormField
        id="note"
        label="Nota (opcional)"
        hint="Por ejemplo: cierre de mes, revisión por faltante."
      >
        {(control) => (
          <Input
            {...control}
            name="note"
            defaultValue={state.values.note}
            key={`note-${state.values.note}`}
            maxLength={200}
            autoComplete="off"
          />
        )}
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <ClipboardCheck aria-hidden="true" data-icon="inline-start" />
        )}
        {pending ? "Iniciando…" : "Iniciar conteo"}
      </Button>
    </form>
  );
}
