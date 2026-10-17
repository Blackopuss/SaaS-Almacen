"use client";

import { CircleCheck, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { resendAction, type ResendFormState } from "./actions";

export function ResendForm() {
  const [state, formAction, pending] = useActionState<
    ResendFormState,
    FormData
  >(resendAction, { status: "idle" });

  if (state.status === "sent") {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg bg-success/10 p-3 text-sm text-foreground"
      >
        <CircleCheck
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-success"
        />
        Si hay una cuenta pendiente con ese correo, te enviamos un enlace nuevo.
      </p>
    );
  }

  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormField
        id="email"
        label="¿No te llegó? Escribe tu correo para reenviarlo"
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
          />
        )}
      </FormField>
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={pending}
      >
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        {pending ? "Enviando…" : "Reenviar enlace"}
      </Button>
    </form>
  );
}
