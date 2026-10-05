"use client";

import {
  CircleAlert,
  Loader2,
  PackageSearch,
  Search,
  Trash2,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { checkConfirmationAction } from "../actions";
import {
  findExitProductsAction,
  loadExitProductAction,
  registerQuickExitAction,
  type ExitCandidate,
  type QuickExitState,
} from "./actions";
import type { ExitProduct } from "./exit-product";

type Line = {
  /** Identity of the row on screen; the server ignores it. */
  key: string;
  product: ExitProduct;
  quantity: string;
  /** "base", "p:<presentation id>" or "u:<unit code>". */
  capture: string;
  locationId: string;
};

const OTHER = "Otro";
const REASONS = [
  "Venta",
  "Uso interno",
  "Merma o daño",
  "Devolución a proveedor",
  OTHER,
] as const;

const EMPTY: QuickExitState = { lineErrors: {}, fieldErrors: {} };

/**
 * Quick exit (INV-28): products are added one after another — typed or
 * scanned — and everything leaves with one confirmation. Nothing is priced
 * or charged here.
 */
export function QuickExitForm({
  idempotencyKey,
  initial,
  maxLines,
}: {
  /** Key of this confirmation (INV-21), created by the server. */
  idempotencyKey: string;
  /** Product the screen was opened with, if any. */
  initial: ExitProduct | null;
  maxLines: number;
}) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const newLine = (product: ExitProduct): Line => ({
    key: `l${nextKey.current++}`,
    product,
    quantity: "1",
    capture: "base",
    locationId: product.locations[0]?.id ?? "",
  });

  const [lines, setLines] = useState<Line[]>(() =>
    initial && initial.locations.length > 0
      ? [
          {
            key: "l0",
            product: initial,
            quantity: "1",
            capture: "base",
            locationId: initial.locations[0]!.id,
          },
        ]
      : [],
  );
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<ExitCandidate[]>([]);
  /** What happened with the last search or addition. */
  const [notice, setNotice] = useState<string | null>(
    initial && initial.locations.length === 0
      ? `${initial.name} no tiene existencias: no puede salir.`
      : null,
  );
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [reference, setReference] = useState("");
  /** Problem of each line, by its key: lines may move after an answer. */
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [lost, setLost] = useState<"checking" | "unknown" | "missing" | null>(
    null,
  );

  // A reader types faster than the server answers: what the answers
  // change is the list as of the last change, not the one of the render
  // that started the search.
  const latest = useRef<Line[] | null>(null);
  const current = () => latest.current ?? lines;
  function commit(next: Line[]) {
    latest.current = next;
    setLines(next);
  }

  function add(product: ExitProduct) {
    const now = current();
    if (product.locations.length === 0) {
      setNotice(`${product.name} no tiene existencias: no puede salir.`);
      return;
    }
    // Scanned or chosen again: one more of the same, when it is counted
    // in whole units of the product.
    const again = now.find(
      (line) =>
        line.product.id === product.id &&
        line.capture === "base" &&
        /^\d{1,9}$/.test(line.quantity.trim()),
    );
    if (again) {
      const more = String(BigInt(again.quantity.trim()) + BigInt(1));
      commit(
        now.map((line) =>
          line.key === again.key ? { ...line, quantity: more } : line,
        ),
      );
      setNotice(`${product.name}: ahora van ${more}.`);
      return;
    }
    if (now.length >= maxLines) {
      setNotice(
        `Una salida admite hasta ${maxLines} líneas. Confirma esta y sigue en otra.`,
      );
      return;
    }
    commit([...now, newLine(product)]);
    setNotice(`Agregaste ${product.name}.`);
  }

  // Codes wait in line (INV-29): a reader sends the next one before the
  // previous has an answer, and none may be lost or change places.
  const queue = useRef<string[]>([]);
  const draining = useRef(false);

  function enqueue(text: string) {
    const typed = text.trim().slice(0, 100);
    searchRef.current?.focus();
    if (typed === "") return;
    queue.current.push(typed);
    setQuery("");
    if (!draining.current) void drain();
  }

  async function drain() {
    draining.current = true;
    setSearching(true);
    try {
      for (
        let typed = queue.current.shift();
        typed !== undefined;
        typed = queue.current.shift()
      ) {
        try {
          const found = await findExitProductsAction(typed);
          if (found.error) {
            setCandidates([]);
            setNotice(found.error);
          } else if (found.exact) {
            add(found.exact);
            setCandidates([]);
          } else {
            setCandidates(found.candidates);
            setNotice(
              found.candidates.length === 0
                ? `No encontramos productos activos con «${typed}». Revisa cómo está escrito.`
                : `Elige el producto de «${typed}».`,
            );
          }
        } catch {
          setNotice(
            `No pudimos buscar «${typed}». Revisa tu conexión y vuelve a intentarlo.`,
          );
        }
      }
    } finally {
      draining.current = false;
      setSearching(false);
    }
  }

  const [choosing, setChoosing] = useState(false);
  async function choose(candidate: ExitCandidate) {
    setChoosing(true);
    try {
      const product = await loadExitProductAction(candidate.id);
      if (product) {
        add(product);
        setCandidates([]);
      } else {
        setNotice(`${candidate.name} ya no está disponible.`);
      }
    } catch {
      setNotice("No pudimos agregarlo. Revisa tu conexión.");
    } finally {
      setChoosing(false);
      searchRef.current?.focus();
    }
  }

  function change(key: string, patch: Partial<Line>) {
    commit(
      current().map((line) =>
        line.key === key ? { ...line, ...patch } : line,
      ),
    );
    if (lineErrors[key]) setLineErrors(without(lineErrors, key));
  }

  function remove(key: string) {
    commit(current().filter((line) => line.key !== key));
    setLineErrors(without(lineErrors, key));
    searchRef.current?.focus();
  }

  /** Asks the server, with patience, whether this confirmation exists. */
  async function findOut(): Promise<"registered" | "missing" | "unknown"> {
    setLost("checking");
    for (const wait of [0, 1500, 3000, 6000, 10000]) {
      if (wait > 0) await waitOrOnline(wait);
      try {
        const check = await checkConfirmationAction(idempotencyKey);
        if (check.registered && check.movementId) {
          router.push(`/movimientos?registrado=${check.movementId}`);
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

  const [state, formAction, pending] = useActionState(
    async (prev: QuickExitState, formData: FormData) => {
      let next: QuickExitState;
      try {
        next = await registerQuickExitAction(prev, formData);
      } catch (error) {
        // Navigation after a success travels as an error: let it through.
        unstable_rethrow(error);
        // No answer arrived: find out whether the exit was registered
        // before letting the person send it again (INV-22).
        const outcome = await findOut();
        if (outcome === "missing") setLost(null);
        next = {
          ...EMPTY,
          formError:
            outcome === "missing"
              ? "Se perdió la conexión y esta salida no se registró. Puedes enviarla de nuevo: no se duplicará."
              : undefined,
        };
      }
      // Errors come by position in what was sent; lines keep them by key.
      const sent = JSON.parse(String(formData.get("lines") ?? "[]")) as {
        key: string;
      }[];
      setLineErrors(
        Object.fromEntries(
          Object.entries(next.lineErrors).flatMap(([index, error]) => {
            const line = sent[Number(index)];
            return line ? [[line.key, error]] : [];
          }),
        ),
      );
      return next;
    },
    EMPTY,
  );

  const payload = JSON.stringify(
    lines.map((line) => ({
      key: line.key,
      productId: line.product.id,
      locationId: line.locationId,
      quantity: line.quantity,
      capture: line.capture,
    })),
  );
  const problems = Object.keys(lineErrors).length;

  return (
    <div className="max-w-2xl space-y-6">
      <section aria-labelledby="agregar-producto" className="space-y-2">
        <h2 id="agregar-producto" className="font-medium">
          Agregar producto
        </h2>
        <div className="flex items-center gap-2">
          <label htmlFor="buscar-producto" className="sr-only">
            Nombre, clave o código de barras del producto que sale
          </label>
          <Input
            ref={searchRef}
            id="buscar-producto"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                // What the box holds now, not what the last render saw.
                enqueue(event.currentTarget.value);
              }
            }}
            placeholder="Nombre, clave o código de barras"
            maxLength={100}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
            autoFocus
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => enqueue(query)}
          >
            {searching ? (
              <Loader2
                aria-hidden="true"
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : (
              <Search aria-hidden="true" data-icon="inline-start" />
            )}
            Buscar
          </Button>
        </div>
        <p role="status" className="min-h-5 text-sm text-muted-foreground">
          {notice}
        </p>
        {candidates.length > 0 && (
          <ul
            aria-label="Productos encontrados"
            className="divide-y rounded-xl border bg-card"
          >
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => void choose(candidate)}
                  disabled={choosing}
                  className="flex min-h-14 w-full items-center gap-3 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{candidate.name}</span>
                    <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                      {candidate.sku} · {candidate.stock}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-primary">
                    Agregar
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={formAction} noValidate className="space-y-5">
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="lines" value={payload} />
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
                <span className="font-medium">Esta salida no se registró.</span>{" "}
                Ya hay conexión: puedes enviarla de nuevo, no se duplicará.
              </p>
            ) : lost === "checking" ? (
              <p>
                <span className="font-medium">Verificando estado…</span> Se
                perdió la conexión al confirmar. Estamos revisando si la salida
                se registró; no cierres esta pantalla.
              </p>
            ) : (
              <div className="space-y-2">
                <p>
                  <span className="font-medium">Seguimos sin conexión.</span> No
                  sabemos todavía si la salida se registró. Cuando vuelva tu
                  internet, verifica antes de capturarla otra vez.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => findOut()}
                >
                  Verificar de nuevo
                </Button>
              </div>
            )}
          </div>
        )}
        {(state.formError || problems > 0) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            {state.formError ??
              (problems === 1
                ? "No se registró nada: una línea necesita corregirse."
                : `No se registró nada: ${problems} líneas necesitan corregirse.`)}
          </div>
        )}

        <section
          aria-labelledby="lineas-salida"
          className="rounded-xl border bg-card"
        >
          <div className="flex items-baseline justify-between gap-3 border-b p-4 sm:px-5">
            <h2 id="lineas-salida" className="font-medium">
              Lo que sale
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {lines.length === 1 ? "1 línea" : `${lines.length} líneas`}
            </p>
          </div>
          {lines.length === 0 ? (
            <div className="flex items-start gap-3 p-4 text-sm text-muted-foreground sm:px-5">
              <PackageSearch aria-hidden="true" className="size-5 shrink-0" />
              <p>
                Busca o escanea el primer producto. Cada uno se agrega como una
                línea y todo sale con una sola confirmación.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {lines.map((line, index) => {
                const error = lineErrors[line.key];
                const errorId = `${line.key}-error`;
                const source = line.product.locations.find(
                  (location) => location.id === line.locationId,
                );
                return (
                  <li key={line.key} className="space-y-3 p-4 sm:px-5">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1">
                        <span className="block font-medium [overflow-wrap:anywhere]">
                          {line.product.name}
                        </span>
                        <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                          {line.product.sku}
                          {line.product.locations.length === 1 &&
                            source &&
                            ` · ${source.label}`}
                        </span>
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Quitar ${line.product.name} (línea ${index + 1})`}
                        onClick={() => remove(line.key)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <div className="w-28">
                        <label
                          htmlFor={`${line.key}-quantity`}
                          className="sr-only"
                        >
                          Cantidad de {line.product.name}
                        </label>
                        <Input
                          id={`${line.key}-quantity`}
                          value={line.quantity}
                          onChange={(event) =>
                            change(line.key, { quantity: event.target.value })
                          }
                          onFocus={(event) => event.target.select()}
                          onKeyDown={(event) => {
                            // Enter here goes back to the search, not to
                            // confirming the whole exit by accident.
                            if (event.key === "Enter") {
                              event.preventDefault();
                              searchRef.current?.focus();
                            }
                          }}
                          inputMode="decimal"
                          autoComplete="off"
                          maxLength={40}
                          aria-invalid={Boolean(error)}
                          aria-describedby={error ? errorId : undefined}
                          className="tabular-nums"
                        />
                      </div>
                      {line.product.captures.length > 1 ? (
                        <div className="min-w-36 flex-1">
                          <label
                            htmlFor={`${line.key}-capture`}
                            className="sr-only"
                          >
                            En qué se cuenta {line.product.name}
                          </label>
                          <NativeSelect
                            id={`${line.key}-capture`}
                            value={line.capture}
                            onChange={(event) =>
                              change(line.key, { capture: event.target.value })
                            }
                          >
                            {line.product.captures.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      ) : (
                        <p className="flex min-h-11 items-center text-sm text-muted-foreground">
                          {line.product.captures[0]?.label.toLowerCase()}
                        </p>
                      )}
                      {line.product.locations.length > 1 && (
                        <div className="min-w-48 flex-[2_1_12rem]">
                          <label
                            htmlFor={`${line.key}-location`}
                            className="sr-only"
                          >
                            De dónde sale {line.product.name}
                          </label>
                          <NativeSelect
                            id={`${line.key}-location`}
                            value={line.locationId}
                            onChange={(event) =>
                              change(line.key, {
                                locationId: event.target.value,
                              })
                            }
                          >
                            {line.product.locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      )}
                    </div>
                    {error && (
                      <p
                        id={errorId}
                        className="flex items-start gap-1.5 text-sm text-destructive"
                      >
                        <CircleAlert
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0"
                        />
                        {error}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <FormField
          id="motivo"
          label="Motivo"
          error={reason === OTHER ? undefined : state.fieldErrors.reason}
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              {REASONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {reason === OTHER && (
          <FormField
            id="otro-motivo"
            label="¿Cuál es el motivo?"
            error={state.fieldErrors.reason}
          >
            {(control) => (
              <Input
                {...control}
                value={otherReason}
                onChange={(event) => setOtherReason(event.target.value)}
                autoComplete="off"
                maxLength={500}
              />
            )}
          </FormField>
        )}
        <input
          type="hidden"
          name="reason"
          value={reason === OTHER ? otherReason : reason}
        />
        <FormField
          id="referencia"
          label="Referencia (opcional)"
          hint="Nota de venta, pedido o a quién se entregó."
          error={state.fieldErrors.reference}
        >
          {(control) => (
            <Input
              {...control}
              name="reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              autoComplete="off"
              maxLength={120}
            />
          )}
        </FormField>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              pending ||
              lines.length === 0 ||
              lost === "checking" ||
              lost === "unknown"
            }
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending
              ? "Registrando…"
              : lines.length > 1
                ? `Registrar salida de ${lines.length} líneas`
                : "Registrar salida"}
          </Button>
          <Button asChild variant="outline">
            <Link href="/movimientos">Cancelar</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The errors of every line but one. */
const without = (errors: Record<string, string>, key: string) =>
  Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key));

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
