"use client";

import { CircleAlert, Equal, Loader2, WifiOff } from "lucide-react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  checkConfirmationAction,
  previewEntryAction,
  registerEntryAction,
  registerExitAction,
  registerInitialBalanceAction,
  registerTransferAction,
  type EntryFormState,
  type EntryPreview,
} from "../actions";

/** Texts and action of each use of the form. */
const MODES = {
  entry: {
    action: registerEntryAction,
    quantity: "¿Cuánto entra?",
    location: "¿Dónde lo guardas?",
    reference: "Remisión, factura o nota con la que llegó.",
    submit: "Registrar entrada",
    busy: "Registrando…",
    cancel: "/movimientos",
  },
  exit: {
    action: registerExitAction,
    quantity: "¿Cuánto sale?",
    location: "¿De dónde sale?",
    reference: "Nota de venta, pedido o a quién se entregó.",
    submit: "Registrar salida",
    busy: "Registrando…",
    cancel: "/movimientos",
  },
  transfer: {
    action: registerTransferAction,
    quantity: "¿Cuánto se mueve?",
    location: "¿De dónde sale?",
    reference: null,
    submit: "Reubicar",
    busy: "Reubicando…",
    cancel: "/movimientos",
  },
  initial: {
    action: registerInitialBalanceAction,
    quantity: "¿Cuánto hay hoy?",
    location: "¿Dónde está?",
    reference: null,
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
  destinations,
  idempotencyKey,
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
  /** Where it can go, for a relocation (INV-23): every active location. */
  destinations?: { id: string; label: string }[];
  /**
   * Key of this confirmation, created by the server with the screen. It
   * travels again if the person retries, so a repeat never writes a second
   * movement (INV-21).
   */
  idempotencyKey: string;
}) {
  const router = useRouter();
  /** What is happening when a confirmation got no answer. */
  const [lost, setLost] = useState<"checking" | "unknown" | "missing" | null>(
    null,
  );

  /** Asks the server, with patience, whether this confirmation exists. */
  async function findOut(): Promise<"registered" | "missing" | "unknown"> {
    setLost("checking");
    for (const wait of [0, 1500, 3000, 6000, 10000]) {
      if (wait > 0) await waitOrOnline(wait);
      try {
        const check = await checkConfirmationAction(idempotencyKey);
        if (check.registered && check.movementId) {
          router.push(
            mode === "initial"
              ? `/movimientos/saldo-inicial?guardado=${check.movementId}`
              : `/movimientos?registrado=${check.movementId}`,
          );
          return "registered";
        }
        setLost("missing");
        return "missing";
      } catch {
        // Still unreachable: wait and ask again.
      }
    }
    setLost("unknown");
    return "unknown";
  }

  async function resolveLostAnswer(
    formData: FormData,
  ): Promise<EntryFormState> {
    const text = (name: string) => String(formData.get(name) ?? "");
    const values = {
      locationId: text("locationId"),
      quantity: text("quantity"),
      capture: text("capture") || "base",
      reference: text("reference"),
      reason: text("reason"),
      toLocationId: text("toLocationId"),
    };
    const outcome = await findOut();
    // The form itself says it below, next to what was typed.
    if (outcome === "missing") setLost(null);
    return {
      fieldErrors: {},
      formError:
        outcome === "missing"
          ? "Se perdió la conexión y este movimiento no se registró. Puedes enviarlo de nuevo: no se duplicará."
          : undefined,
      values,
    };
  }

  // React resets a form after its action; the answers count how many came
  // back so the select is rebuilt showing what the person had chosen.
  const [answers, setAnswers] = useState(0);
  const [state, formAction, pending] = useActionState(
    async (prev: EntryFormState, formData: FormData) => {
      let next: EntryFormState;
      try {
        next = await MODES[mode].action(productId, prev, formData);
      } catch (error) {
        // Navigation after a success travels as an error: let it through.
        unstable_rethrow(error);
        // No answer arrived (the connection dropped, or the server could
        // not reply): find out whether the movement was registered before
        // letting the person send it again (INV-22).
        next = await resolveLostAnswer(formData);
      }
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
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {lost && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border bg-muted/50 p-3 text-sm text-foreground"
        >
          {lost === "checking" ? (
            <Loader2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 animate-spin"
            />
          ) : (
            <WifiOff
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
          )}
          {lost === "missing" ? (
            <p>
              <span className="font-medium">
                Este movimiento no se registró.
              </span>{" "}
              Ya hay conexión: puedes enviarlo de nuevo, no se duplicará.
            </p>
          ) : lost === "checking" ? (
            <p>
              <span className="font-medium">Verificando estado…</span> Se perdió
              la conexión al confirmar. Estamos revisando si el movimiento se
              registró; no cierres esta pantalla.
            </p>
          ) : (
            <div className="space-y-2">
              <p>
                <span className="font-medium">Seguimos sin conexión.</span> No
                sabemos todavía si el movimiento se registró. Cuando vuelva tu
                internet, verifica antes de capturarlo otra vez.
              </p>
              <Button type="button" variant="outline" onClick={() => findOut()}>
                Verificar de nuevo
              </Button>
            </div>
          )}
        </div>
      )}
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
      {destinations && (
        <FormField
          id="toLocationId"
          label="¿A dónde va?"
          error={state.fieldErrors.toLocationId}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="toLocationId"
              defaultValue={state.values.toLocationId ?? ""}
              key={`destination-${state.values.toLocationId ?? ""}-${answers}`}
            >
              <option value="">Elige una ubicación</option>
              {destinations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}
      {texts.reference && (
        <FormField
          id="reference"
          label="Referencia (opcional)"
          hint={texts.reference}
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
        <Button
          type="submit"
          disabled={pending || lost === "checking" || lost === "unknown"}
        >
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

/** Waits up to `ms`, or less if the browser says the connection is back. */
function waitOrOnline(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("online", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener("online", done);
  });
}
