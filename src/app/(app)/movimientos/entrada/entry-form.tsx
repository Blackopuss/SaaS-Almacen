"use client";

import { CircleAlert, Equal, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  previewEntryAction,
  registerEntryAction,
  registerInitialBalanceAction,
  type EntryFormState,
  type EntryPreview,
} from "../actions";

/** Texts of the two uses of the form: an entry, or the initial balance. */
const MODES = {
  entry: {
    quantity: "¿Cuánto entra?",
    location: "¿Dónde lo guardas?",
    submit: "Registrar entrada",
    busy: "Registrando…",
    cancel: "/movimientos",
  },
  initial: {
    quantity: "¿Cuánto hay hoy?",
    location: "¿Dónde está?",
    submit: "Guardar saldo inicial",
    busy: "Guardando…",
    cancel: "/movimientos/saldo-inicial",
  },
} as const;

/**
 * Form of an entry (INV-16/17): how much, counted in what, where, and an
 * optional note. When the quantity is counted in boxes or in another unit,
 * the server answers what it is in the product's unit before confirming.
 */
export function EntryForm({
  mode = "entry",
  productId,
  captures,
  locations,
  defaultLocationId,
}: {
  mode?: keyof typeof MODES;
  productId: string;
  /**
   * Ways to count what arrives, built in the server: the product's unit
   * first ("base"), then its presentations and compatible units.
   */
  captures: { value: string; label: string; hint: string }[];
  /** Path of each location and what it holds today. */
  locations: { id: string; label: string }[];
  defaultLocationId: string;
}) {
  // React resets a form after its action; the answers count how many came
  // back so the select is rebuilt showing what the person had chosen.
  const [answers, setAnswers] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (prev: EntryFormState, formData: FormData) => {
      const next = await (
        mode === "initial" ? registerInitialBalanceAction : registerEntryAction
      )(productId, prev, formData);
      setAnswers((count) => count + 1);
      return next;
    },
    {
      fieldErrors: {},
      values: {
        locationId: defaultLocationId,
        quantity: "",
        capture: "base",
        reference: "",
        reason: "",
      },
    } satisfies EntryFormState,
  );
  const quantityRef = useRef<HTMLInputElement>(null);
  const [capture, setCapture] = useState(state.values.capture);
  const [preview, setPreview] = useState<EntryPreview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  // After a refusal, take the person back to the quantity when it is the problem.
  useEffect(() => {
    if (state.fieldErrors.quantity) quantityRef.current?.focus();
  }, [state]);

  /** Asks the server for the equivalence a moment after the person stops typing. */
  function askPreview(nextCapture: string, quantity: string) {
    if (timer.current) clearTimeout(timer.current);
    const request = ++latest.current;
    if (nextCapture === "base" || quantity.trim() === "") {
      setPreview(null);
      return;
    }
    timer.current = setTimeout(async () => {
      const result = await previewEntryAction(productId, nextCapture, quantity);
      // Only the answer to what is on screen now counts.
      if (request === latest.current) setPreview(result);
    }, 300);
  }

  const chosen =
    captures.find((option) => option.value === capture) ?? captures[0];
  const texts = MODES[mode];

  return (
    <form action={formAction} noValidate className="max-w-xl space-y-5">
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
      <FormField
        id="quantity"
        label={texts.quantity}
        hint={chosen?.hint}
        error={state.fieldErrors.quantity}
      >
        {(control) => (
          <Input
            {...control}
            ref={quantityRef}
            name="quantity"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={state.values.quantity}
            key={`quantity-${state.values.quantity}`}
            onChange={(event) => askPreview(capture, event.target.value)}
            maxLength={20}
            required
            autoFocus
          />
        )}
      </FormField>
      {captures.length > 1 ? (
        <FormField id="capture" label="¿En qué lo cuentas?">
          {(control) => (
            <NativeSelect
              {...control}
              name="capture"
              defaultValue={capture}
              key={`capture-${answers}`}
              onChange={(event) => {
                setCapture(event.target.value);
                askPreview(
                  event.target.value,
                  quantityRef.current?.value ?? "",
                );
              }}
            >
              {captures.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : (
        <input type="hidden" name="capture" value="base" />
      )}
      <div aria-live="polite">
        {preview?.ok && (
          <p className="flex items-start gap-2 rounded-lg border bg-muted p-3 text-sm font-medium">
            <Equal
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            {preview.preview}
          </p>
        )}
        {preview && !preview.ok && (
          <p className="text-sm text-muted-foreground">{preview.error}</p>
        )}
      </div>
      <FormField
        id="locationId"
        label={texts.location}
        error={state.fieldErrors.locationId}
      >
        {(control) => (
          <NativeSelect
            {...control}
            name="locationId"
            defaultValue={state.values.locationId}
            key={`location-${state.values.locationId}`}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {mode === "entry" && (
        <FormField
          id="reference"
          label="Referencia (opcional)"
          hint="Remisión, factura o nota con la que llegó."
          error={state.fieldErrors.reference}
        >
          {(control) => (
            <Input
              {...control}
              name="reference"
              autoComplete="off"
              defaultValue={state.values.reference}
              key={`reference-${state.values.reference}`}
              maxLength={120}
            />
          )}
        </FormField>
      )}
      <FormField
        id="reason"
        label="Nota (opcional)"
        error={state.fieldErrors.reason}
      >
        {(control) => (
          <Input
            {...control}
            name="reason"
            autoComplete="off"
            defaultValue={state.values.reason}
            key={`reason-${state.values.reason}`}
            maxLength={500}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? texts.busy : texts.submit}
        </Button>
        <Button asChild variant="outline">
          <Link href={texts.cancel}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
