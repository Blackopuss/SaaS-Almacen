"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

import { saveMappingAction, type MappingState } from "../actions";

type Column = {
  key: string;
  header: string;
  required: boolean;
  help: string;
};

/**
 * Column map of an import (IMP-04): which column of the file is each of
 * ours, and how the file writes decimals. The first guess comes from the
 * titles; the decimal separator is never preselected.
 */
export function MappingForm({
  importId,
  columns,
  fileColumns,
  mapping,
  decimalSeparator,
}: {
  importId: string;
  /** Our columns, in the order of the template. */
  columns: Column[];
  /** Columns of the file: position and title («Columna C» when untitled). */
  fileColumns: { index: number; label: string }[];
  /** Current choice: our column → position in the file ("" = not there). */
  mapping: Record<string, string>;
  decimalSeparator: string;
}) {
  // React resets a form after its action; the answers count how many came
  // back so selects are rebuilt showing what the person had chosen.
  const [answers, setAnswers] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (prev: MappingState, formData: FormData) => {
      const next = await saveMappingAction(importId, prev, formData);
      setAnswers((count) => count + 1);
      return next;
    },
    {
      fieldErrors: {},
      values: { mapping, decimalSeparator },
    } satisfies MappingState,
  );
  const separatorError = state.fieldErrors.decimalSeparator;

  return (
    <form action={formAction} noValidate className="space-y-6">
      {state.formError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
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
          separatorError ? "decimales-error" : "decimales-ayuda"
        }
      >
        <legend className="font-medium">
          ¿Cómo vienen los decimales en tu archivo?
        </legend>
        <p id="decimales-ayuda" className="text-sm text-muted-foreground">
          No lo adivinamos: «1,234» puede ser mil doscientos treinta y cuatro o
          uno punto dos tres cuatro. Elige la que usa tu archivo.
        </p>
        <div className="flex flex-wrap gap-2" key={`separator-${answers}`}>
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
                defaultChecked={state.values.decimalSeparator === option.value}
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
        {separatorError && (
          <p
            id="decimales-error"
            className="flex items-start gap-1.5 text-sm text-destructive"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            {separatorError}
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-medium">
          ¿Qué columna de tu archivo es cada dato?
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {columns.map((column) => (
            <FormField
              key={column.key}
              id={`column-${column.key}`}
              label={`${column.header}${column.required ? " (obligatoria)" : ""}`}
              hint={column.help}
              error={
                state.fieldErrors[
                  column.key as keyof MappingState["fieldErrors"]
                ]
              }
            >
              {(control) => (
                <NativeSelect
                  {...control}
                  name={`column.${column.key}`}
                  defaultValue={state.values.mapping[column.key] ?? ""}
                  key={`${column.key}-${answers}`}
                >
                  <option key="none" value="">
                    No está en mi archivo
                  </option>
                  {fileColumns.map((option) => (
                    <option key={option.index} value={String(option.index)}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Guardando…" : "Guardar columnas"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {state.saved && !pending && (
            <span className="inline-flex items-start gap-1.5">
              <CircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
              Columnas guardadas. Revisa abajo cómo se leen tus números.
            </span>
          )}
        </p>
      </div>
    </form>
  );
}
