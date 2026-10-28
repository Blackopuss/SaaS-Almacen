"use client";

import { CircleAlert, Loader2, Plus } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  updateInstallmentTermsAction,
  type InstallmentTermsFormState,
} from "./actions";

type Row = { key: number; months: string; interest: string };

/**
 * The terms the company sells on installments (PAG-01): months and the
 * interest added to what is financed. No terms = only cash sales.
 */
export function InstallmentTermsForm({
  terms,
  maxTerms,
}: {
  /** «6» months, «10» % interest. */
  terms: { months: string; interest: string }[];
  maxTerms: number;
}) {
  const next = useRef(terms.length);
  const [rows, setRows] = useState<Row[]>(() =>
    terms.map((term, index) => ({ key: index, ...term })),
  );
  const [state, formAction, pending] = useActionState<
    InstallmentTermsFormState,
    FormData
  >(updateInstallmentTermsAction, { rowErrors: {}, answers: 0 });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.saved) toast.success("Plazos guardados.");
    const first = Object.keys(state.rowErrors)[0];
    if (first !== undefined) {
      formRef.current
        ?.querySelector<HTMLElement>(`[data-row="${first}"] input`)
        ?.focus();
    }
  }, [state]);

  const change = (key: number, patch: Partial<Row>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      aria-labelledby="plazos"
      className="max-w-xl space-y-4 rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 id="plazos" className="font-medium">
          Ventas a plazos
        </h2>
        <p className="text-sm text-muted-foreground">
          El interés se suma una vez a lo que queda después del enganche.
        </p>
      </div>
      {state.formError && (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm text-destructive"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {state.formError}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm">Sin plazos: todas las ventas son de contado.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, index) => {
            const error = state.rowErrors[index];
            const id = `plazo-${row.key}`;
            return (
              <li key={row.key} data-row={index} className="space-y-1">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-28 space-y-1">
                    <Label htmlFor={`${id}-meses`}>Meses</Label>
                    <Input
                      id={`${id}-meses`}
                      name="months"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={2}
                      value={row.months}
                      onChange={(event) =>
                        change(row.key, { months: event.target.value })
                      }
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${id}-error` : undefined}
                      className="tabular-nums"
                    />
                  </div>
                  <div className="w-36 space-y-1">
                    <Label htmlFor={`${id}-interes`}>Interés (%)</Label>
                    <Input
                      id={`${id}-interes`}
                      name="interest"
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={6}
                      placeholder="0"
                      value={row.interest}
                      onChange={(event) =>
                        change(row.key, { interest: event.target.value })
                      }
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${id}-error` : undefined}
                      className="tabular-nums"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setRows(rows.filter((other) => other.key !== row.key))
                    }
                  >
                    Quitar
                    <span className="sr-only"> el plazo {index + 1}</span>
                  </Button>
                </div>
                {error && (
                  <p id={`${id}-error`} className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {rows.length < maxTerms && (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setRows([
                ...rows,
                { key: next.current++, months: "", interest: "" },
              ])
            }
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            Agregar plazo
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          Guardar plazos
        </Button>
      </div>
    </form>
  );
}
