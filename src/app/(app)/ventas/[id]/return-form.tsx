"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  cancelSaleAction,
  checkSaleReturnAction,
  returnSaleAction,
  type ReturnFormState,
} from "./actions";

export type ReturnFormLine = {
  saleLineId: string;
  name: string;
  unitLabel: string;
  sold: string;
  returned: string;
  returnable: string;
  unitPrice: string;
};

const METHODS = [
  { value: "CASH", label: "Efectivo" },
  { value: "CARD", label: "Tarjeta" },
  { value: "TRANSFER", label: "Transferencia" },
] as const;

const initial = (refundMethod: string): ReturnFormState => ({
  lineErrors: {},
  fieldErrors: {},
  values: { quantities: {}, reason: "", refundMethod, reference: "" },
  answers: 0,
});

/**
 * Returning goods of a sale (VEN-19/20) or cancelling it (VEN-21): what
 * comes back, how the money goes back and why. The refund is computed by
 * the server; a lost answer is checked by its key, never retried blindly.
 */
export function ReturnForm({
  mode,
  saleId,
  lines,
  left,
  defaultMethod,
  idempotencyKey,
}: {
  mode: "return" | "cancel";
  saleId: string;
  lines: ReturnFormLine[];
  /** What a cancellation gives back. */
  left: string;
  defaultMethod: string;
  idempotencyKey: string;
}) {
  const [key] = useState(idempotencyKey);
  const router = useRouter();
  const [lost, setLost] = useState<"checking" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: ReturnFormState, formData: FormData) => {
      const run = mode === "cancel" ? cancelSaleAction : returnSaleAction;
      try {
        return await run(saleId, prev, formData);
      } catch (error) {
        unstable_rethrow(error);
        setLost("checking");
        for (const wait of [0, 1500, 3000, 6000]) {
          if (wait > 0) await new Promise((done) => setTimeout(done, wait));
          try {
            const found = await checkSaleReturnAction(key);
            setLost(null);
            if (found) {
              // It was registered: the answer got lost on the way back.
              router.push(
                `/ventas/${found.saleId}?devolucion=${found.returnId}`,
              );
              return prev;
            }
            return {
              ...prev,
              answers: prev.answers + 1,
              formError:
                "Se perdió la conexión y no se registró nada. Puedes intentarlo de nuevo: no se duplicará.",
            };
          } catch {
            // Still unreachable: wait and ask again.
          }
        }
        setLost(null);
        return {
          ...prev,
          answers: prev.answers + 1,
          formError:
            "Se perdió la conexión y no sabemos si se registró. Revisa la venta antes de intentarlo otra vez.",
        };
      }
    },
    initial(defaultMethod),
  );
  // The method picked since the last answer; else the one last sent.
  const [picked, setPicked] = useState<{ at: number; method: string }>();
  const method =
    picked && picked.at === state.answers
      ? picked.method
      : state.values.refundMethod || defaultMethod;

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const line = lines.find((l) => state.lineErrors[l.saleLineId]);
    const name = line
      ? `q:${line.saleLineId}`
      : (["refundMethod", "reference", "reason"] as const).find(
          (field) => state.fieldErrors[field],
        );
    if (name) form.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
    else if (state.formError) {
      form.querySelector<HTMLElement>("[data-form-error]")?.focus();
    }
  }, [state, lines]);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="max-w-xl space-y-5 rounded-xl border bg-card p-4 sm:p-5"
    >
      <input type="hidden" name="idempotencyKey" value={key} />
      {state.formError && (
        <div
          role="alert"
          tabIndex={-1}
          data-form-error
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm outline-none"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </div>
      )}

      {mode === "return" ? (
        <fieldset className="space-y-3">
          <legend className="mb-2 font-medium">¿Qué regresa?</legend>
          <ul className="divide-y rounded-lg border">
            {lines.map((line) => {
              const id = `regresan-${line.saleLineId}`;
              const error = state.lineErrors[line.saleLineId];
              const none = line.returnable === "0";
              return (
                <li
                  key={line.saleLineId}
                  className="grid gap-3 p-3 sm:grid-cols-[1fr_8rem] sm:items-start"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {line.name}
                    </p>
                    <p className="text-muted-foreground">
                      {line.unitLabel} · {line.unitPrice} c/u
                    </p>
                    <p className="text-muted-foreground tabular-nums">
                      Vendido {line.sold}
                      {line.returned !== "0" &&
                        ` · ya regresó ${line.returned}`}
                    </p>
                  </div>
                  {none ? (
                    <p className="text-sm text-muted-foreground sm:text-right">
                      Ya regresó todo
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <Label htmlFor={id}>
                        <span className="sr-only">{line.name}: </span>
                        Regresan
                      </Label>
                      <Input
                        id={id}
                        name={`q:${line.saleLineId}`}
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={20}
                        placeholder="0"
                        defaultValue={
                          state.values.quantities[line.saleLineId] ?? ""
                        }
                        key={`q-${line.saleLineId}-${state.answers}`}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? `${id}-error` : `${id}-hint`}
                        className="tabular-nums"
                      />
                      {error ? (
                        <p
                          id={`${id}-error`}
                          className="text-sm text-destructive"
                        >
                          {error}
                        </p>
                      ) : (
                        <p
                          id={`${id}-hint`}
                          className="text-sm text-muted-foreground"
                        >
                          Hasta {line.returnable}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            Regresa al inventario todo lo que queda de la venta y se devuelven{" "}
            <span className="font-medium tabular-nums">{left}</span>.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {lines
              .filter((line) => line.returnable !== "0")
              .map((line) => (
                <li key={line.saleLineId}>
                  {line.returnable} × {line.name} ({line.unitLabel})
                </li>
              ))}
          </ul>
        </div>
      )}

      <fieldset
        key={`method-${state.answers}`}
        aria-describedby={
          state.fieldErrors.refundMethod ? "devolucion-metodo-error" : undefined
        }
      >
        <legend className="mb-2 text-sm font-medium">
          ¿Cómo se devuelve el dinero?
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border bg-card px-2 text-sm font-medium has-checked:border-primary has-checked:bg-primary/5 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="refundMethod"
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
        {state.fieldErrors.refundMethod && (
          <p
            id="devolucion-metodo-error"
            className="mt-2 text-sm text-destructive"
          >
            {state.fieldErrors.refundMethod}
          </p>
        )}
      </fieldset>

      {method !== "CASH" && (
        <FormField
          id="devolucion-referencia"
          label={
            method === "CARD"
              ? "Autorización de la devolución en la terminal"
              : "Referencia de la transferencia"
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

      <FormField
        id="devolucion-motivo"
        label="Motivo"
        error={state.fieldErrors.reason}
      >
        {(control) => (
          <Input
            {...control}
            name="reason"
            autoComplete="off"
            maxLength={500}
            placeholder={
              mode === "cancel" ? "Se cobró dos veces" : "No le quedó"
            }
            defaultValue={state.values.reason}
            key={`reason-${state.answers}`}
          />
        )}
      </FormField>

      <Button
        type="submit"
        variant={mode === "cancel" ? "destructive" : "default"}
        disabled={pending}
      >
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        {lost === "checking"
          ? "Revisando si se registró…"
          : mode === "cancel"
            ? "Cancelar venta"
            : "Registrar devolución"}
      </Button>
    </form>
  );
}
