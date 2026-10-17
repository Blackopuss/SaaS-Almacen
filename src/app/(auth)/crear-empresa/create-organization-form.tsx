"use client";

import { CircleAlert, Loader2, Store } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { FormField, WarehouseCard } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { signOutAction } from "../../(app)/actions";
import {
  createOrganizationAction,
  type CreateOrganizationState,
} from "./actions";

const FIELD_ORDER = ["name", "timeZone"] as const;

export function CreateOrganizationForm({
  userName,
  timeZones,
}: {
  userName: string;
  timeZones: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState<
    CreateOrganizationState,
    FormData
  >(createOrganizationAction, {
    fieldErrors: {},
    values: { name: "", timeZone: timeZones[0]!.id },
  });
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, move focus to the first field with an error.
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => state.fieldErrors[field]);
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
  }, [state]);

  return (
    <WarehouseCard>
      <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <Store aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        Crea tu empresa
      </h1>
      <p className="mt-2 text-muted-foreground">
        Hola, {userName}. Dinos cómo se llama tu negocio; serás su titular y
        podrás invitar a tu equipo después.
      </p>

      {state.formError && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </div>
      )}

      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="mt-6 space-y-5"
      >
        <FormField
          id="name"
          label="Nombre del negocio"
          hint="Por ejemplo: Ferretería La Esperanza."
          error={state.fieldErrors.name}
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              autoComplete="organization"
              defaultValue={state.values.name}
              key={`name-${state.values.name}`}
              required
              maxLength={120}
            />
          )}
        </FormField>

        <FormField
          id="timeZone"
          label="Zona horaria"
          hint="La mayoría del país usa la hora del Centro. Tus movimientos y reportes usan esta hora."
          error={state.fieldErrors.timeZone}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="timeZone"
              defaultValue={state.values.timeZone}
              key={`tz-${state.values.timeZone}`}
            >
              {timeZones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Creando empresa…" : "Crear empresa"}
        </Button>
      </form>

      <form action={signOutAction} className="mt-6 text-center text-sm">
        <span className="text-muted-foreground">¿No es tu cuenta? </span>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0"
        >
          Cerrar sesión
        </button>
      </form>
    </WarehouseCard>
  );
}
