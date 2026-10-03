"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { FadeIn, FormField, PasswordInput } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { registerAction, type RegisterFormState } from "./actions";

const initialState: RegisterFormState = {
  fieldErrors: {},
  values: { name: "", email: "" },
};

const FIELD_ORDER = ["name", "email", "password"] as const;

export function RegisterForm({ minLength }: { minLength: number }) {
  const [state, formAction, pending] = useActionState(
    registerAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, move focus to the first field with an error.
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => state.fieldErrors[field]);
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
  }, [state]);

  return (
    <FadeIn className="w-full max-w-md">
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Crea tu cuenta
          </h1>
          <p className="text-muted-foreground">
            Empieza a controlar tu inventario en minutos.
          </p>
        </div>

        {state.formError && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
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
          <FormField id="name" label="Nombre" error={state.fieldErrors.name}>
            {(control) => (
              <Input
                {...control}
                name="name"
                autoComplete="name"
                defaultValue={state.values.name}
                key={`name-${state.values.name}`}
                required
                maxLength={120}
              />
            )}
          </FormField>

          <FormField
            id="email"
            label="Correo electrónico"
            error={state.fieldErrors.email}
          >
            {(control) => (
              <Input
                {...control}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                defaultValue={state.values.email}
                key={`email-${state.values.email}`}
                required
                maxLength={254}
              />
            )}
          </FormField>

          <FormField
            id="password"
            label="Contraseña"
            hint={`Mínimo ${minLength} caracteres. Una frase fácil de recordar funciona bien.`}
            error={state.fieldErrors.password}
          >
            {(control) => (
              <PasswordInput
                {...control}
                name="password"
                autoComplete="new-password"
                required
                minLength={minLength}
                maxLength={128}
              />
            )}
          </FormField>

          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Creando cuenta…" : "Crear cuenta"}
          </Button>
        </form>
      </div>
    </FadeIn>
  );
}
