"use client";

import { Loader2, Upload } from "lucide-react";
import { useActionState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { startImportAction, type UploadState } from "./actions";

/** Picks the spreadsheet to import and sends it (IMP-04). */
export function UploadForm() {
  const [state, formAction, pending] = useActionState(
    startImportAction,
    {} satisfies UploadState,
  );
  return (
    <form action={formAction} noValidate className="space-y-4">
      <FormField
        id="file"
        label="Tu archivo"
        hint="Excel (.xlsx) o CSV, hasta 10 MB y 20,000 filas. Solo se lee su texto: las fórmulas y macros no se ejecutan."
        error={state.error}
      >
        {(control) => (
          <Input
            {...control}
            name="file"
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="h-auto max-w-md py-2"
          />
        )}
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Upload aria-hidden="true" data-icon="inline-start" />
        )}
        {pending ? "Leyendo tu archivo…" : "Subir y revisar columnas"}
      </Button>
    </form>
  );
}
