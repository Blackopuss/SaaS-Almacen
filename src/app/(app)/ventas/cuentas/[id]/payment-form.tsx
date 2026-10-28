"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  checkPaymentAction,
  registerPaymentAction,
  type PaymentFormState,
} from "../actions";

const METHODS = [
  { value: "CASH", label: "Efectivo" },
  { value: "CARD", label: "Tarjeta" },
  { value: "TRANSFER", label: "Transferencia" },
] as const;

/**
 * A payment to an account (PAG-05): how much and how. It goes to the
 * oldest installment; a lost answer is checked by its key.
 */
export function PaymentForm({
  receivableId,
  suggested,
  idempotencyKey,
}: {
  receivableId: string;
  /** What is due now: «1466.66». */
  suggested: string;
  idempotencyKey: string;
}) {
  const router = useRouter();
  const [key] = useState(idempotencyKey);
  const [lost, setLost] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: PaymentFormState, formData: FormData) => {
      try {
        return await registerPaymentAction(receivableId, prev, formData);
      } catch (error) {
        unstable_rethrow(error);
        setLost(true);
        for (const wait of [0, 1500, 3000, 6000]) {
          if (wait > 0) await new Promise((done) => setTimeout(done, wait));
          try {
            const found = await checkPaymentAction(key);
            setLost(false);
            if (found) {
              router.push(
                `/ventas/cuentas/${found.receivableId}?abono=${found.paymentId}`,
              );
              return prev;
            }
            return {
              ...prev,
              answers: prev.answers + 1,
              formError:
                "Se perdió la conexión y el abono no se registró. Puedes intentarlo de nuevo: no se duplicará.",
            };
          } catch {
            // Still unreachable: wait and ask again.
          }
        }
        setLost(false);
        return {
          ...prev,
          answers: prev.answers + 1,
          formError:
            "Se perdió la conexión y no sabemos si el abono quedó registrado. Revisa la cuenta antes de cobrar otra vez.",
        };
      }
    },
    {
      fieldErrors: {},
      values: {
        amount: suggested,
        method: "CASH",
        received: "",
        reference: "",
      },
      answers: 0,
    },
  );
  const [picked, setPicked] = useState<{ at: number; method: string }>();
  const method =
    picked && picked.at === state.answers ? picked.method : state.values.method;

  return (
    <form
      action={formAction}
      noValidate
      aria-labelledby="registrar-abono"
      className="space-y-4 rounded-xl border bg-card p-4 sm:p-5 print:hidden"
    >
      <h2 id="registrar-abono" className="font-medium">
        Registrar abono
      </h2>
      <input type="hidden" name="idempotencyKey" value={key} />
      {state.formError && (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm text-destructive"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {state.formError}
        </p>
      )}
      <FormField
        id="abono-importe"
        label="Importe ($)"
        error={state.fieldErrors.amount}
      >
        {(control) => (
          <Input
            {...control}
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            maxLength={16}
            defaultValue={state.values.amount}
            key={`amount-${state.answers}`}
            className="tabular-nums"
          />
        )}
      </FormField>
      <fieldset key={`method-${state.answers}`}>
        <legend className="mb-2 text-sm font-medium">Forma de pago</legend>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border bg-card px-2 text-sm font-medium has-checked:border-primary has-checked:bg-primary/5 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="method"
                value={option.value}
                defaultChecked={method === option.value}
                onChange={() =>
                  setPicked({ at: state.answers, method: option.value })
                }
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      {method === "CASH" ? (
        <FormField
          id="abono-recibido"
          label="Recibido"
          hint="Vacío = paga exacto."
          error={state.fieldErrors.received}
        >
          {(control) => (
            <Input
              {...control}
              name="received"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              defaultValue={state.values.received}
              key={`received-${state.answers}`}
              className="tabular-nums"
            />
          )}
        </FormField>
      ) : (
        <FormField
          id="abono-referencia"
          label={
            method === "CARD"
              ? "Número de autorización"
              : "Clave de rastreo o referencia"
          }
          error={state.fieldErrors.reference}
        >
          {(control) => (
            <Input
              {...control}
              name="reference"
              autoComplete="off"
              maxLength={60}
              defaultValue={state.values.reference}
              key={`reference-${state.answers}`}
            />
          )}
        </FormField>
      )}
      <Button type="submit" disabled={pending || lost}>
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        {lost ? "Revisando si quedó registrado…" : "Cobrar abono"}
      </Button>
    </form>
  );
}
