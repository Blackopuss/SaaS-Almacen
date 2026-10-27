"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  updateSalesSettingsAction,
  type SalesSettingsFormState,
} from "./actions";

const MODES = [
  {
    value: "included",
    label: "Mis precios ya incluyen IVA",
    detail: "El cliente paga el precio que ve; el ticket desglosa el IVA.",
  },
  {
    value: "added",
    label: "Mis precios no incluyen IVA",
    detail: "El IVA se suma al cobrar.",
  },
] as const;

const CAP_FIELDS = [
  { role: "cashier", label: "Cajero" },
  { role: "cash_manager", label: "Encargado de caja" },
  { role: "administrator", label: "Administrador" },
] as const;

/** How the company charges VAT (VEN-04) and the discount caps (VEN-14). */
export function SalesSettingsForm({
  taxMode,
  taxRate,
  caps,
}: {
  taxMode: "included" | "added";
  /** «16». */
  taxRate: string;
  /** «5», by role. */
  caps: Record<(typeof CAP_FIELDS)[number]["role"], string>;
}) {
  const [state, formAction, pending] = useActionState<
    SalesSettingsFormState,
    FormData
  >(updateSalesSettingsAction, {
    fieldErrors: {},
    values: { taxMode, taxRate, ...caps },
    answers: 0,
  });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.saved) toast.success("Guardado.");
    const cap = CAP_FIELDS.find(
      (field) => state.fieldErrors[`cap.${field.role}`],
    );
    const first = state.fieldErrors.taxMode
      ? "input[name=taxMode]"
      : state.fieldErrors.taxRate
        ? "#taxRate"
        : cap
          ? `#cap-${cap.role}`
          : null;
    if (first) formRef.current?.querySelector<HTMLElement>(first)?.focus();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="max-w-xl space-y-5"
    >
      {state.formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </div>
      )}
      <fieldset
        className="space-y-2"
        aria-describedby={
          state.fieldErrors.taxMode ? "taxMode-error" : undefined
        }
      >
        <legend className="mb-2 text-sm font-medium">Tus precios</legend>
        {/* React resets the form after its action: the key makes the
            options show again what the person had chosen. */}
        <div className="space-y-2" key={state.answers}>
          {MODES.map((mode) => (
            <label
              key={mode.value}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-card px-4 py-3 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="taxMode"
                value={mode.value}
                defaultChecked={state.values.taxMode === mode.value}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{mode.label}</span>
                <span className="block text-sm text-muted-foreground">
                  {mode.detail}
                </span>
              </span>
            </label>
          ))}
        </div>
        {state.fieldErrors.taxMode && (
          <p
            id="taxMode-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {state.fieldErrors.taxMode}
          </p>
        )}
      </fieldset>
      <FormField
        id="taxRate"
        label="Tasa de IVA (%)"
        error={state.fieldErrors.taxRate}
      >
        {(control) => (
          <Input
            {...control}
            name="taxRate"
            inputMode="decimal"
            autoComplete="off"
            maxLength={8}
            defaultValue={state.values.taxRate}
            key={`rate-${state.answers}`}
            className="max-w-32"
          />
        )}
      </FormField>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Descuento máximo sin pedir autorización
        </legend>
        <p className="text-sm text-muted-foreground">
          Arriba de su tope, alguien con tope mayor lo autoriza con su
          contraseña. Tú no tienes tope.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {CAP_FIELDS.map((field) => (
            <FormField
              key={field.role}
              id={`cap-${field.role}`}
              label={`${field.label} (%)`}
              error={state.fieldErrors[`cap.${field.role}`]}
            >
              {(control) => (
                <Input
                  {...control}
                  name={`cap.${field.role}`}
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={8}
                  defaultValue={state.values[field.role]}
                  key={`${field.role}-${state.answers}`}
                />
              )}
            </FormField>
          ))}
        </div>
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
        Guardar
      </Button>
    </form>
  );
}
