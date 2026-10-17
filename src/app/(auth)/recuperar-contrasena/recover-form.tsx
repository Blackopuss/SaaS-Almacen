"use client";

import { CircleCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { recoverAction, type RecoverFormState } from "./actions";

const linkClass =
  "rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export function RecoverForm() {
  const [state, formAction, pending] = useActionState<
    RecoverFormState,
    FormData
  >(recoverAction, { status: "idle" });

  return (
    <>
      {state.status === "sent" ? (
        <div className="mt-6 space-y-3">
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg bg-success/10 p-3 text-sm text-foreground"
          >
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-success"
            />
            Si hay una cuenta con ese correo, te enviamos un enlace para
            restablecer tu contraseña.
          </p>
          <p className="text-sm text-muted-foreground">
            Si no lo ves en unos minutos, revisa tu carpeta de spam o
            promociones.
          </p>
        </div>
      ) : (
        <form action={formAction} noValidate className="mt-6 space-y-5">
          <FormField
            id="email"
            label="Correo electrónico"
            error={state.status === "error" ? state.error : undefined}
          >
            {(control) => (
              <Input
                {...control}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                defaultValue={state.status === "error" ? state.email : ""}
                required
                maxLength={254}
              />
            )}
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Enviando…" : "Enviar enlace"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        ¿Ya la recordaste?{" "}
        <Link href="/ingresar" className={linkClass}>
          Inicia sesión
        </Link>
      </p>
    </>
  );
}
