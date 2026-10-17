"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField, PasswordInput } from "@/components";
import { Button } from "@/components/ui/button";

import { resetAction, type ResetFormState } from "./actions";

export function ResetForm({
  token,
  minLength,
}: {
  token: string;
  minLength: number;
}) {
  const [state, formAction, pending] = useActionState<ResetFormState, FormData>(
    resetAction,
    { status: "idle" },
  );
  const passwordRef = useRef<HTMLInputElement>(null);

  // After a rejected password, focus the field again.
  useEffect(() => {
    if (state.status === "error") passwordRef.current?.focus();
  }, [state]);

  if (state.status === "invalid-token") return <InvalidLink />;

  if (state.status === "done") {
    return (
      <>
        <div role="status">
          <span className="grid size-12 place-items-center rounded-full bg-success/10 text-success">
            <CircleCheck aria-hidden="true" className="size-6" />
          </span>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            Contraseña actualizada
          </h1>
          <p className="mt-2 text-muted-foreground">
            Cerramos todas tus sesiones abiertas por seguridad. Inicia sesión
            con tu contraseña nueva.
          </p>
        </div>
        <Button asChild size="lg" className="mt-6 w-full">
          <Link href="/ingresar">Iniciar sesión</Link>
        </Button>
      </>
    );
  }

  const formError =
    state.status === "error" && !state.field ? state.error : undefined;
  const passwordError =
    state.status === "error" && state.field ? state.error : undefined;

  return (
    <>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Elige una contraseña nueva
        </h1>
        <p className="text-muted-foreground">
          Al guardarla cerraremos todas tus sesiones abiertas.
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {formError}
        </div>
      )}

      <form action={formAction} noValidate className="mt-6 space-y-5">
        <input type="hidden" name="token" value={token} />
        <FormField
          id="password"
          label="Contraseña nueva"
          hint={`Mínimo ${minLength} caracteres. Una frase fácil de recordar funciona bien.`}
          error={passwordError}
        >
          {(control) => (
            <PasswordInput
              {...control}
              ref={passwordRef}
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
          {pending ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>
    </>
  );
}

export function InvalidLink() {
  return (
    <>
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        El enlace no es válido
      </h1>
      <p className="mt-2 text-muted-foreground">
        Puede que haya vencido o que ya lo hayas usado. Pide uno nuevo para
        restablecer tu contraseña.
      </p>
      <Button asChild size="lg" className="mt-6 w-full">
        <Link href="/recuperar-contrasena">Pedir un enlace nuevo</Link>
      </Button>
    </>
  );
}
