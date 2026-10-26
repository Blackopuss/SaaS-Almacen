"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import {
  createPromoCodeAction,
  disablePromoCodeAction,
  type PromoCodeState,
} from "./actions";

const EMPTY = {
  code: "",
  percentOff: "",
  maxRedemptions: "1",
  validUntil: "",
  note: "",
};

/** Form to create a discount code (ADR 0028). */
export function CreateCodeForm() {
  const [state, formAction, pending] = useActionState(createPromoCodeAction, {
    fieldErrors: {},
  } satisfies PromoCodeState);
  const shown = { ...EMPTY, ...state.values };
  const attempt = JSON.stringify(state);
  const errors = state.fieldErrors;

  return (
    <section
      aria-labelledby="crear-codigo"
      className="rounded-xl border bg-card p-4 sm:p-5"
    >
      <h2 id="crear-codigo" className="font-medium">
        Crear código
      </h2>
      <p className="text-sm text-muted-foreground">
        El titular lo escribe al comprar su plan. Un uso se cuenta cuando la
        compra queda pagada.
      </p>
      {state.formError && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </p>
      )}
      {state.created && (
        <p
          role="status"
          className="mt-4 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          {`Código ${state.created} creado.`}
        </p>
      )}
      <form action={formAction} noValidate className="mt-5 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="code"
            label="Código"
            hint="Por ejemplo PEPITOGRATIS. Letras, números o guiones."
            error={errors.code}
          >
            {(control) => (
              <Input
                {...control}
                name="code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
                key={`code-${attempt}`}
                defaultValue={shown.code}
                required
              />
            )}
          </FormField>
          <FormField
            id="percentOff"
            label="Descuento (%)"
            hint="De 1 a 100. 100 = gratis."
            error={errors.percentOff}
          >
            {(control) => (
              <Input
                {...control}
                name="percentOff"
                inputMode="numeric"
                autoComplete="off"
                key={`percentOff-${attempt}`}
                defaultValue={String(shown.percentOff)}
                required
              />
            )}
          </FormField>
          <FormField
            id="maxRedemptions"
            label="Usos máximos"
            error={errors.maxRedemptions}
          >
            {(control) => (
              <Input
                {...control}
                name="maxRedemptions"
                inputMode="numeric"
                autoComplete="off"
                key={`maxRedemptions-${attempt}`}
                defaultValue={String(shown.maxRedemptions)}
                required
              />
            )}
          </FormField>
          <FormField
            id="validUntil"
            label="Último día válido (opcional)"
            hint="Vacío = sin caducidad. Hora del centro de México."
            error={errors.validUntil}
          >
            {(control) => (
              <Input
                {...control}
                name="validUntil"
                type="date"
                key={`validUntil-${attempt}`}
                defaultValue={shown.validUntil}
              />
            )}
          </FormField>
        </div>
        <FormField
          id="note"
          label="Nota (opcional)"
          hint="Para quién o para qué es. Solo la ve el personal."
          error={errors.note}
        >
          {(control) => (
            <Input
              {...control}
              name="note"
              autoComplete="off"
              maxLength={200}
              key={`note-${attempt}`}
              defaultValue={shown.note}
            />
          )}
        </FormField>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Creando…" : "Crear código"}
        </Button>
      </form>
    </section>
  );
}

/** «Desactivar» with a confirmation dialog: it cannot be undone. */
export function DisableCodeButton({ id, code }: { id: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Desactivar</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Desactivar el código {code}?</DialogTitle>
          <DialogDescription>
            Ya no se podrá usar en compras nuevas. Las compras que ya lo usaron
            no cambian. No se puede volver a activar.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Todavía no
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await disablePromoCodeAction(id);
                if (result.ok) {
                  toast.success(`Código ${code} desactivado.`);
                  setOpen(false);
                } else {
                  setError(result.error);
                }
              });
            }}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Desactivando…" : "Desactivar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
