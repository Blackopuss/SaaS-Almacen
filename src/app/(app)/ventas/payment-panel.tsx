"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type Method = "CASH" | "CARD" | "TRANSFER";
export type PayMode = Method | "MIXED";

export type PaymentRow = {
  key: string;
  method: Method;
  amount: string;
  received: string;
  reference: string;
};

export const METHOD_LABELS: Record<Method, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

const MODES: { value: PayMode; label: string }[] = [
  { value: "CASH", label: "Efectivo" },
  { value: "CARD", label: "Tarjeta" },
  { value: "TRANSFER", label: "Transferencia" },
  { value: "MIXED", label: "Varias" },
];

const REFERENCE_LABEL: Record<Exclude<Method, "CASH">, string> = {
  CARD: "Número de autorización",
  TRANSFER: "Clave de rastreo o referencia",
};

/**
 * How the customer pays (VEN-11..13): cash (what was handed over; the
 * change comes from the server), card or transfer with their reference —
 * the terminal is outside the app — or several of them that add up to the
 * total.
 */
export function PaymentPanel({
  mode,
  onMode,
  single,
  onSingle,
  rows,
  onRows,
  errors,
  maxPayments,
  newRow,
}: {
  mode: PayMode;
  onMode: (mode: PayMode) => void;
  single: { received: string; reference: string };
  onSingle: (single: { received: string; reference: string }) => void;
  rows: PaymentRow[];
  onRows: (rows: PaymentRow[]) => void;
  /** Problem of each payment: by position for one, by row key for several. */
  errors: Record<string, string>;
  maxPayments: number;
  newRow: (method: Method) => PaymentRow;
}) {
  const change = (key: string, patch: Partial<PaymentRow>) =>
    onRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Forma de pago</legend>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium has-checked:border-primary has-checked:bg-primary/5 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="payMode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => onMode(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "CASH" && (
        <Field
          id="pago-recibido"
          label="Recibido"
          hint="Vacío = paga exacto."
          error={errors["0"]}
        >
          <Input
            id="pago-recibido"
            value={single.received}
            onChange={(event) =>
              onSingle({ ...single, received: event.target.value })
            }
            inputMode="decimal"
            autoComplete="off"
            maxLength={20}
            aria-invalid={Boolean(errors["0"])}
            aria-describedby={
              errors["0"] ? "pago-recibido-error" : "pago-recibido-hint"
            }
            className="tabular-nums"
          />
        </Field>
      )}
      {(mode === "CARD" || mode === "TRANSFER") && (
        <Field
          id="pago-referencia"
          label={REFERENCE_LABEL[mode]}
          error={errors["0"]}
        >
          <Input
            id="pago-referencia"
            value={single.reference}
            onChange={(event) =>
              onSingle({ ...single, reference: event.target.value })
            }
            autoComplete="off"
            maxLength={60}
            aria-invalid={Boolean(errors["0"])}
            aria-describedby={errors["0"] ? "pago-referencia-error" : undefined}
          />
        </Field>
      )}
      {mode === "MIXED" && (
        <ul className="space-y-3">
          {rows.map((row, index) => {
            const error = errors[row.key];
            const id = `pago-${row.key}`;
            return (
              <li key={row.key} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <label htmlFor={`${id}-metodo`} className="sr-only">
                    Forma del pago {index + 1}
                  </label>
                  <NativeSelect
                    id={`${id}-metodo`}
                    value={row.method}
                    onChange={(event) =>
                      change(row.key, {
                        method: event.target.value as Method,
                      })
                    }
                  >
                    {(Object.keys(METHOD_LABELS) as Method[]).map((method) => (
                      <option key={method} value={method}>
                        {METHOD_LABELS[method]}
                      </option>
                    ))}
                  </NativeSelect>
                  {rows.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        onRows(rows.filter((other) => other.key !== row.key))
                      }
                    >
                      <Trash2 aria-hidden="true" data-icon="inline-start" />
                      Quitar
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor={`${id}-importe`} className="text-sm">
                      Importe
                    </label>
                    <Input
                      id={`${id}-importe`}
                      value={row.amount}
                      onChange={(event) =>
                        change(row.key, { amount: event.target.value })
                      }
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={20}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? `${id}-error` : undefined}
                      className="tabular-nums"
                    />
                  </div>
                  {row.method === "CASH" ? (
                    <div className="space-y-1">
                      <label htmlFor={`${id}-recibido`} className="text-sm">
                        Recibido
                      </label>
                      <Input
                        id={`${id}-recibido`}
                        value={row.received}
                        onChange={(event) =>
                          change(row.key, { received: event.target.value })
                        }
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={20}
                        className="tabular-nums"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label htmlFor={`${id}-referencia`} className="text-sm">
                        Referencia
                      </label>
                      <Input
                        id={`${id}-referencia`}
                        value={row.reference}
                        onChange={(event) =>
                          change(row.key, { reference: event.target.value })
                        }
                        autoComplete="off"
                        maxLength={60}
                      />
                    </div>
                  )}
                </div>
                {error && (
                  <p id={`${id}-error`} className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
          {rows.length < maxPayments && (
            <li>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRows([...rows, newRow("TRANSFER")])}
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                Agregar otra forma de pago
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
