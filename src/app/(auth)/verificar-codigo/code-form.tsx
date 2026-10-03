"use client";

import { CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

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
  // Backup codes (PLT-09) when the phone is not at hand.
  const [backup, setBackup] = useState(false);

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
        {backup ? "Usa un código de recuperación" : "Escribe tu código"}
      </h1>
      <p className="mt-2 text-muted-foreground">
        {backup
          ? "Escribe uno de los códigos que guardaste al activar la verificación. Cada uno sirve una sola vez."
          : "Abre tu app de autenticación y escribe el código de 6 números de Almacén."}
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
          <input
            type="hidden"
            name="method"
            value={backup ? "backup" : "totp"}
          />
          <FormField
            id="code"
            label={backup ? "Código de recuperación" : "Código de 6 números"}
            error={state.error}
          >
            {(control) => (
              <Input
                {...control}
                key={backup ? "backup" : "totp"}
                ref={codeRef}
                name="code"
                inputMode={backup ? "text" : "numeric"}
                autoComplete={backup ? "off" : "one-time-code"}
                autoCapitalize="none"
                maxLength={backup ? 13 : 7}
                spellCheck={false}
                autoFocus
                placeholder={backup ? "k7m2p-9xq4t" : undefined}
                className="font-mono tracking-widest"
                required
              />
            )}
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Verificando…" : "Verificar"}
          </Button>
          <Button
            type="button"
            variant="link"
            className="w-full"
            onClick={() => setBackup((value) => !value)}
          >
            {backup
              ? "Usar el código de mi app"
              : "¿No tienes tu teléfono? Usa un código de recuperación"}
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
