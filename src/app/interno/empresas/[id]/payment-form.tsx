"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { PaymentState, ReversalState } from "./actions";

const FIELD_ORDER = [
  "amount",
  "paidOn",
  "reference",
  "months",
  "notes",
] as const;

const EMPTY = { amount: "", paidOn: "", reference: "", months: "1", notes: "" };

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
  }).format(new Date(iso));
}

function Alert({ tone, children }: { tone: "error" | "ok"; children: string }) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
          : "mt-4 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-foreground"
      }
    >
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-4 shrink-0 ${tone === "error" ? "text-destructive" : "text-success"}`}
      />
      {children}
    </div>
  );
}

/** Form to register a SPEI payment of the company (PIL-11). */
export function PaymentForm({
  action,
}: {
  action: (prev: PaymentState, formData: FormData) => Promise<PaymentState>;
}) {
  const [state, formAction, pending] = useActionState(action, {
    fieldErrors: {},
  });
  const formRef = useRef<HTMLFormElement>(null);
  const shown = {
    ...EMPTY,
    ...state.values,
    months: String(state.values?.months ?? "1"),
  };
  const attempt = JSON.stringify(state);

  useEffect(() => {
    const first = FIELD_ORDER.find((field) => state.fieldErrors[field]);
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
  }, [state]);

  return (
    <section
      aria-labelledby="registrar-pago"
      className="rounded-xl border bg-card p-4 sm:p-5"
    >
      <h2 id="registrar-pago" className="font-medium">
        Registrar pago
      </h2>
      <p className="text-sm text-muted-foreground">
        Una transferencia SPEI recibida. Extiende la vigencia del plan desde su
        fin (o desde hoy, si ya venció) y queda en la bitácora de la empresa.
      </p>

      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {state.savedUntil && (
        <Alert tone="ok">
          {`Pago registrado. El plan queda vigente hasta el ${formatDay(state.savedUntil)}.`}
        </Alert>
      )}

      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="mt-5 space-y-5"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="amount"
            label="Importe recibido (MXN)"
            error={state.fieldErrors.amount}
          >
            {(control) => (
              <Input
                {...control}
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                key={`amount-${attempt}`}
                defaultValue={shown.amount}
                required
              />
            )}
          </FormField>
          <FormField
            id="paidOn"
            label="Día del pago"
            error={state.fieldErrors.paidOn}
          >
            {(control) => (
              <Input
                {...control}
                name="paidOn"
                type="date"
                key={`paidOn-${attempt}`}
                defaultValue={shown.paidOn}
                required
              />
            )}
          </FormField>
          <FormField
            id="reference"
            label="Clave de rastreo SPEI"
            hint="Viene en el comprobante del banco."
            error={state.fieldErrors.reference}
          >
            {(control) => (
              <Input
                {...control}
                name="reference"
                autoComplete="off"
                maxLength={60}
                key={`reference-${attempt}`}
                defaultValue={shown.reference}
                required
              />
            )}
          </FormField>
          <FormField
            id="months"
            label="Meses que paga"
            error={state.fieldErrors.months}
          >
            {(control) => (
              <Input
                {...control}
                name="months"
                inputMode="numeric"
                autoComplete="off"
                key={`months-${attempt}`}
                defaultValue={shown.months}
                required
              />
            )}
          </FormField>
        </div>
        <FormField
          id="notes"
          label="Notas (opcional)"
          hint="Por ejemplo, el banco de origen o datos para la factura."
          error={state.fieldErrors.notes}
        >
          {(control) => (
            <Input
              {...control}
              name="notes"
              autoComplete="off"
              maxLength={500}
              key={`notes-${attempt}`}
              defaultValue={shown.notes}
            />
          )}
        </FormField>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Registrando…" : "Registrar pago"}
        </Button>
      </form>
    </section>
  );
}

/** Reverses one payment, with its reason (PIL-11). */
export function ReversePaymentForm({
  id,
  action,
}: {
  id: string;
  action: (prev: ReversalState, formData: FormData) => Promise<ReversalState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const field = `reason-${id}`;
  return (
    <details className="mt-2 text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        Anular pago
      </summary>
      <form action={formAction} noValidate className="mt-2 space-y-3">
        <FormField
          id={field}
          label="Motivo"
          hint="Quita los mismos meses de la vigencia. Después puedes registrarlo bien."
          error={state.error}
        >
          {(control) => (
            <Input
              {...control}
              name="reason"
              autoComplete="off"
              maxLength={500}
              key={`${field}-${JSON.stringify(state)}`}
              defaultValue={state.reason ?? ""}
              required
            />
          )}
        </FormField>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Anulando…" : "Anular"}
        </Button>
      </form>
    </details>
  );
}
