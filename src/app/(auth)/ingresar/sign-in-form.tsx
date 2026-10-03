"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { WarehouseCard, FormField, PasswordInput } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { signInAction, type SignInFormState } from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<
    SignInFormState,
    FormData
  >(signInAction, { email: "" });
  const passwordRef = useRef<HTMLInputElement>(null);

  // After a failed attempt, clear and focus the password field.
  useEffect(() => {
    if (state.error && passwordRef.current) {
      passwordRef.current.value = "";
      passwordRef.current.focus();
    }
  }, [state]);

  return (
    <WarehouseCard>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Inicia sesión</h1>
        <p className="text-muted-foreground">Entra a tu inventario.</p>
      </div>

      {state.error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.error}
        </div>
      )}

      <form action={formAction} className="mt-6 space-y-5">
        <input type="hidden" name="siguiente" value={next} />
        <FormField id="email" label="Correo electrónico">
          {(control) => (
            <Input
              {...control}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              spellCheck={false}
              defaultValue={state.email}
              key={`email-${state.email}`}
              required
            />
          )}
        </FormField>
        <FormField id="password" label="Contraseña">
          {(control) => (
            <PasswordInput
              {...control}
              ref={passwordRef}
              name="password"
              autoComplete="current-password"
              required
            />
          )}
        </FormField>
        <p className="-mt-2 text-right text-sm">
          <Link
            href="/recuperar-contrasena"
            className="inline-flex min-h-11 items-center rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </p>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Entrando…" : "Iniciar sesión"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        ¿No tienes cuenta?{" "}
        <Link
          href="/registro"
          className="rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Crea una
        </Link>
      </p>
    </WarehouseCard>
  );
}
