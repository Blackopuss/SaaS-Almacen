"use client";

import { Loader2, Upload } from "lucide-react";
import { useActionState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { startExitImportAction, type ExitUploadState } from "./actions";

/** Picks the file of exits, says how its decimals come and sends it (IMP-10). */
export function ExitUploadForm() {
  const [state, formAction, pending] = useActionState(
    startExitImportAction,
    {} satisfies ExitUploadState,
  );
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormField
        id="file"
        label="Tu archivo de salidas"
        hint="CSV o Excel (.xlsx), hasta 10 MB. Solo se lee su texto: las fórmulas y macros no se ejecutan."
        error={state.error}
      >
        {(control) => (
          <Input
            {...control}
            name="file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="h-auto max-w-md py-2"
          />
        )}
      </FormField>
      <fieldset
        className="space-y-2"
        aria-describedby={
          state.separatorError
            ? "separator-hint separator-error"
            : "separator-hint"
        }
      >
        <legend className="text-sm font-medium">
          ¿Cómo vienen los decimales en tu archivo?
        </legend>
        <p id="separator-hint" className="text-sm text-muted-foreground">
          No lo adivinamos: «1,5» puede ser uno y medio o mil quinientos.
        </p>
        {/* React resets the form after its action: the key makes the
            options show again what the person had chosen. */}
        <div className="flex flex-wrap gap-2" key={state.answers ?? 0}>
          {[
            { value: ".", label: "Con punto", example: "2.75 · 1,234.50" },
            { value: ",", label: "Con coma", example: "2,75 · 1.234,50" },
          ].map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-4 py-2 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="decimalSeparator"
                value={option.value}
                defaultChecked={state.decimalSeparator === option.value}
                className="size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-sm text-muted-foreground tabular-nums">
                  {option.example}
                </span>
              </span>
            </label>
          ))}
        </div>
        {state.separatorError && (
          <p
            id="separator-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {state.separatorError}
          </p>
        )}
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Upload aria-hidden="true" data-icon="inline-start" />
        )}
        {pending ? "Leyendo tu archivo…" : "Subir y revisar"}
      </Button>
    </form>
  );
}
