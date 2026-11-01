"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  cashMovementAction,
  closeCashAction,
  openCashAction,
  type CashFormState,
} from "./actions";

const initial: CashFormState = { fieldErrors: {}, values: {}, answers: 0 };

/** Focus the first field with a problem; say «Guardado.» after a save. */
function useAnswer(
  state: CashFormState,
  order: readonly string[],
  saved?: string,
) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved && saved) toast.success(saved);
    const first = order.find((name) => state.fieldErrors[name]);
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
    }
  }, [state, order, saved]);
  return formRef;
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      {message}
    </div>
  );
}

function Money({
  id,
  name,
  label,
  hint,
  state,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  state: CashFormState;
}) {
  return (
    <FormField
      id={id}
      label={label}
      hint={hint}
      error={state.fieldErrors[name]}
    >
      {(control) => (
        <Input
          {...control}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          maxLength={20}
          defaultValue={state.values[name] ?? ""}
          key={`${name}-${state.answers}`}
          className="tabular-nums"
        />
      )}
    </FormField>
  );
}

const OPEN_ORDER = ["openingFloat"] as const;

/** Opening the register: the cash it starts with (VEN-16). */
export function OpenCashForm() {
  const [state, formAction, pending] = useActionState(openCashAction, initial);
  const formRef = useAnswer(state, OPEN_ORDER);
  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="max-w-md space-y-4 rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 className="font-medium">Abre tu caja para cobrar</h2>
        <p className="text-sm text-muted-foreground">
          Cuenta el efectivo con el que empiezas para dar cambio.
        </p>
      </div>
      <FormError message={state.formError} />
      <Money
        id="fondo"
        name="openingFloat"
        label="Efectivo con el que empiezas"
        hint="Vacío = sin efectivo."
        state={state}
      />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        Abrir caja
      </Button>
    </form>
  );
}

const MOVEMENT_ORDER = ["direction", "amount", "reason"] as const;

/** Money put in or taken out, with its reason (VEN-17). */
export function CashMovementForm() {
  const [state, formAction, pending] = useActionState(
    cashMovementAction,
    initial,
  );
  const formRef = useAnswer(state, MOVEMENT_ORDER, "Guardado.");
  const direction = state.values.direction || "OUT";
  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
    >
      <h2 className="font-medium">Meter o sacar dinero</h2>
      <FormError message={state.formError} />
      <fieldset key={`direction-${state.answers}`}>
        <legend className="sr-only">¿Entra o sale dinero?</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "OUT", label: "Sacar" },
            { value: "IN", label: "Meter" },
          ].map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium has-checked:border-primary has-checked:bg-primary/5 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="direction"
                value={option.value}
                defaultChecked={direction === option.value}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Money id="importe" name="amount" label="Importe" state={state} />
        <FormField
          id="motivo-caja"
          label="Motivo"
          error={state.fieldErrors.reason}
        >
          {(control) => (
            <Input
              {...control}
              name="reason"
              autoComplete="off"
              maxLength={200}
              placeholder="Garrafón de agua"
              defaultValue={state.saved ? "" : (state.values.reason ?? "")}
              key={`reason-${state.answers}`}
            />
          )}
        </FormField>
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        Guardar
      </Button>
    </form>
  );
}

const CLOSE_ORDER = ["countedCash", "countedCard", "countedTransfer"] as const;

/** The close: what was counted, by method (VEN-18). */
export function CloseCashForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, pending] = useActionState(
    closeCashAction.bind(null, sessionId),
    initial,
  );
  const formRef = useAnswer(state, CLOSE_ORDER, "Corte guardado.");
  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 className="font-medium">Corte de caja</h2>
        <p className="text-sm text-muted-foreground">
          Cuenta lo que hay, sin ver lo esperado; al guardar se comparan.
        </p>
      </div>
      <FormError message={state.formError} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Money
          id="contado-efectivo"
          name="countedCash"
          label="Efectivo"
          state={state}
        />
        <Money
          id="contado-tarjeta"
          name="countedCard"
          label="Vouchers de tarjeta"
          state={state}
        />
        <Money
          id="contado-transferencia"
          name="countedTransfer"
          label="Transferencias"
          state={state}
        />
      </div>
      <FormField id="nota-corte" label="Nota (opcional)">
        {(control) => (
          <Input
            {...control}
            name="note"
            autoComplete="off"
            maxLength={500}
            defaultValue={state.values.note ?? ""}
            key={`note-${state.answers}`}
          />
        )}
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        Guardar corte
      </Button>
    </form>
  );
}
