"use client";

import { CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField, WarehouseCard } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { verifyCodeAction, type CodeFormState } from "./actions";

const linkClass =
  "rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export function CodeForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<CodeFormState, FormData>(
    verifyCodeAction,
    {},
  );
  const codeRef = useRef<HTMLInputElement>(null);

  // After a wrong code, clear the field and focus it again.
  useEffect(() => {
    if (state.error && !state.restart && codeRef.current) {
      codeRef.current.value = "";
      codeRef.current.focus();
    }
  }, [state]);

  return (
    <WarehouseCard>
      <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <ShieldCheck aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        Escribe tu código
      </h1>
      <p className="mt-2 text-muted-foreground">
        Abre tu app de autenticación y escribe el código de 6 números de
        Almacén.
      </p>

      {state.restart ? (
        <>
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
          <Button asChild size="lg" className="mt-6 w-full">
            <Link href={`/ingresar?siguiente=${encodeURIComponent(next)}`}>
              Volver a iniciar sesión
            </Link>
          </Button>
        </>
      ) : (
        <form action={formAction} noValidate className="mt-6 space-y-5">
          <input type="hidden" name="siguiente" value={next} />
          <FormField id="code" label="Código de 6 números" error={state.error}>
            {(control) => (
              <Input
                {...control}
                ref={codeRef}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                spellCheck={false}
                autoFocus
                className="font-mono tracking-widest"
                required
              />
            )}
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Verificando…" : "Verificar"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        ¿No es tu cuenta?{" "}
        <Link href="/ingresar" className={linkClass}>
          Entrar con otra
        </Link>
      </p>
    </WarehouseCard>
  );
}
