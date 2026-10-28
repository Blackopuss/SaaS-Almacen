"use client";

import {
  CircleAlert,
  Loader2,
  PackageSearch,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { QuotePreview, SaleProduct, SaleSearch } from "@/modules/sales";

import type { SaleCustomer } from "../actions";
import { CustomerPicker } from "../customer-picker";
import {
  findQuoteProductsAction,
  loadQuoteProductAction,
  previewQuoteAction,
  saveQuoteAction,
  type QuoteFormState,
} from "./actions";

const areaClass =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

type Line = {
  /** Identity of the row on screen; the server ignores it. */
  key: string;
  product: SaleProduct;
  quantity: string;
  /** "base" or "p:<presentation id>". */
  capture: string;
};

type Candidate = SaleSearch["candidates"][number];

export type QuoteFormDraft = {
  customer: SaleCustomer | null;
  validUntil: string;
  notes: string;
  discountPercent: string;
  discountReason: string;
  /** «6»; empty = cash (PAG-03). */
  planMonths: string;
  planDownPayment: string;
  lines: { product: SaleProduct; quantity: string; capture: string }[];
};

function without(errors: Record<string, string>, key: string) {
  return Object.fromEntries(
    Object.entries(errors).filter(([name]) => name !== key),
  );
}

const EMPTY: QuoteFormState = { fieldErrors: {}, lineErrors: {}, answers: 0 };

/**
 * A quote being written (COT-02): the customer, until when it holds, the
 * products with how they are sold, an optional discount and notes. What it
 * adds up to comes from the server, a moment after each change.
 */
export function QuoteForm({
  quoteId,
  draft,
  maxLines,
  terms,
  canCreateCustomer,
  cancelHref,
}: {
  /** Null for a new quote. */
  quoteId: string | null;
  draft: QuoteFormDraft;
  maxLines: number;
  /** The company's installment terms: «6» → «6 meses con 10 %». */
  terms: { value: string; label: string }[];
  canCreateCustomer: boolean;
  cancelHref: string;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nextKey = useRef(draft.lines.length + 1);
  const [lines, setLines] = useState<Line[]>(() =>
    draft.lines.map((line, index) => ({ ...line, key: `l${index + 1}` })),
  );
  const [customer, setCustomer] = useState(draft.customer);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [discountPercent, setDiscountPercent] = useState(draft.discountPercent);
  const [planMonths, setPlanMonths] = useState(draft.planMonths);
  const [planDown, setPlanDown] = useState(draft.planDownPayment);
  const [preview, setPreview] = useState<QuotePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** Problems the server found, by line key: lines may move after. */
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});

  function add(product: SaleProduct) {
    if (product.captures.length === 0) {
      setNotice(
        `${product.name} no tiene precio de venta. Pide que se lo pongan en Inventario.`,
      );
      return;
    }
    if (lines.length >= maxLines) {
      setNotice(`Una cotización admite hasta ${maxLines} líneas.`);
      return;
    }
    setLines([
      ...lines,
      {
        key: `l${nextKey.current++}`,
        product,
        quantity: "1",
        capture: product.captures[0]!.value,
      },
    ]);
    setNotice(`Agregaste ${product.name}.`);
  }

  async function search() {
    const typed = query.trim().slice(0, 100);
    if (typed === "") return;
    setSearching(true);
    try {
      const found = await findQuoteProductsAction(typed);
      if (found.error) {
        setCandidates([]);
        setNotice(found.error);
      } else if (found.exact) {
        add(found.exact);
        setCandidates([]);
        setQuery("");
      } else {
        setCandidates(found.candidates);
        setNotice(
          found.candidates.length === 0
            ? `No encontramos productos activos con «${typed}». Revisa cómo está escrito.`
            : `Elige el producto de «${typed}».`,
        );
      }
    } catch {
      setNotice(`No pudimos buscar «${typed}». Revisa tu conexión.`);
    } finally {
      setSearching(false);
    }
  }

  async function choose(candidate: Candidate) {
    try {
      const product = await loadQuoteProductAction(candidate.id);
      if (product) {
        add(product);
        setCandidates([]);
        setQuery("");
      } else {
        setNotice(`${candidate.name} ya no está disponible.`);
      }
    } catch {
      setNotice("No pudimos agregarlo. Revisa tu conexión.");
    } finally {
      searchRef.current?.focus();
    }
  }

  function change(lineKey: string, patch: Partial<Line>) {
    setLines(
      lines.map((line) =>
        line.key === lineKey ? { ...line, ...patch } : line,
      ),
    );
    if (lineErrors[lineKey]) setLineErrors(without(lineErrors, lineKey));
  }

  function remove(lineKey: string) {
    setLines(lines.filter((line) => line.key !== lineKey));
    setLineErrors(without(lineErrors, lineKey));
    searchRef.current?.focus();
  }

  // Totals come from the server, a moment after the last change; an
  // answer to older lines is ignored.
  const payload = JSON.stringify(
    lines.map((line) => ({
      productId: line.product.id,
      capture: line.capture,
      quantity: line.quantity,
    })),
  );
  const asked = useRef(0);
  useEffect(() => {
    const ticket = ++asked.current;
    const timer = setTimeout(async () => {
      try {
        const answer = await previewQuoteAction(
          JSON.parse(payload),
          discountPercent,
          { months: planMonths, downPayment: planDown },
        );
        if (ticket !== asked.current) return;
        if ("error" in answer) {
          setPreview(null);
          setPreviewError(answer.error);
        } else {
          setPreview(answer);
          setPreviewError(null);
        }
      } catch {
        if (ticket === asked.current) {
          setPreviewError(
            "No pudimos calcular el total. Revisa tu conexión; se intentará de nuevo al cambiar algo.",
          );
        }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [payload, discountPercent, planMonths, planDown]);

  const [state, formAction, pending] = useActionState(
    async (prev: QuoteFormState, formData: FormData) => {
      const next = await saveQuoteAction(quoteId, prev, formData);
      // Errors come by position in what was sent; lines keep them by key.
      const sent = JSON.parse(String(formData.get("keys") ?? "[]")) as string[];
      setLineErrors(
        Object.fromEntries(
          Object.entries(next.lineErrors).flatMap(([index, error]) => {
            const lineKey = sent[Number(index)];
            return lineKey ? [[lineKey, error]] : [];
          }),
        ),
      );
      return next;
    },
    EMPTY,
  );

  useEffect(() => {
    const form = formRef.current;
    if (!form || state.answers === 0) return;
    const order = [
      "customerId",
      "validUntil",
      "lines",
      "discountPercent",
      "discountReason",
      "planMonths",
      "planDownPayment",
      "notes",
    ] as const;
    const first = order.find((name) => state.fieldErrors[name]);
    const target = first
      ? form.querySelector<HTMLElement>(`[data-field="${first}"]`)
      : Object.keys(state.lineErrors).length > 0
        ? form.querySelector<HTMLElement>("[aria-invalid='true']")
        : state.formError
          ? form.querySelector<HTMLElement>("[data-form-error]")
          : null;
    target?.focus();
  }, [state]);

  const fresh = preview !== null && preview.lines.length === lines.length;
  const planMonthsError =
    state.fieldErrors.planMonths ??
    (preview?.planError?.field === "planMonths"
      ? preview.planError.error
      : undefined);
  const planDownError =
    state.fieldErrors.planDownPayment ??
    (preview?.planError?.field === "planDownPayment" && planDown.trim() !== ""
      ? preview.planError.error
      : undefined);
  const units = lines.length === 1 ? "1 producto" : `${lines.length} productos`;

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <input type="hidden" name="lines" value={payload} />
      <input
        type="hidden"
        name="keys"
        value={JSON.stringify(lines.map((line) => line.key))}
      />
      <input type="hidden" name="customerId" value={customer?.id ?? ""} />

      <div className="min-w-0 space-y-6">
        {state.formError && (
          <div
            role="alert"
            tabIndex={-1}
            data-form-error
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm outline-none"
          >
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            {state.formError}
          </div>
        )}

        <section
          aria-labelledby="cliente-cotizacion"
          className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
        >
          <h2 id="cliente-cotizacion" className="font-medium">
            Cliente
          </h2>
          <div tabIndex={-1} data-field="customerId" className="outline-none">
            <CustomerPicker
              value={customer}
              onChange={setCustomer}
              canCreate={canCreateCustomer}
              emptyLabel="Sin cliente"
            />
          </div>
          {state.fieldErrors.customerId && !customer && (
            <p className="text-sm text-destructive">
              {state.fieldErrors.customerId}
            </p>
          )}
        </section>

        <section aria-labelledby="agregar-producto" className="space-y-2">
          <h2 id="agregar-producto" className="sr-only">
            Agregar producto
          </h2>
          <div className="flex items-center gap-2">
            <label htmlFor="buscar-producto" className="sr-only">
              Nombre, clave o código de barras del producto
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
                  void search();
                }
              }}
              placeholder="Nombre, clave o código de barras"
              maxLength={100}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void search()}
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
                    className="flex min-h-14 w-full items-center gap-3 p-3 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {candidate.name}
                      </span>
                      <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                        {candidate.sku}
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

        <section
          aria-labelledby="productos-cotizacion"
          className="rounded-xl border bg-card"
        >
          <div className="flex items-baseline justify-between gap-3 border-b p-4 sm:px-5">
            <h2 id="productos-cotizacion" className="font-medium">
              Productos
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {units}
            </p>
          </div>
          {lines.length === 0 ? (
            <div
              tabIndex={-1}
              data-field="lines"
              className="flex items-start gap-3 p-4 text-sm text-muted-foreground outline-none sm:px-5"
            >
              <PackageSearch aria-hidden="true" className="size-5 shrink-0" />
              <p>
                {state.fieldErrors.lines ? (
                  <span className="text-destructive">
                    {state.fieldErrors.lines}
                  </span>
                ) : (
                  "Busca un producto para agregarlo. Puedes agregar varios."
                )}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {lines.map((line, index) => {
                const priced = fresh ? preview.lines[index] : undefined;
                const error = lineErrors[line.key] ?? priced?.error;
                const errorId = `${line.key}-error`;
                const capture = line.product.captures.find(
                  (option) => option.value === line.capture,
                );
                return (
                  <li key={line.key} className="space-y-3 p-4 sm:px-5">
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1">
                        <span className="block font-medium [overflow-wrap:anywhere]">
                          {line.product.name}
                        </span>
                        <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                          {line.product.sku} · {capture?.price ?? ""} c/u
                        </span>
                      </p>
                      <p className="shrink-0 text-right font-medium tabular-nums">
                        {priced?.amount ?? "…"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                            En qué se cotiza {line.product.name}
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
                                {option.label} · {option.price}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      ) : (
                        <p className="flex min-h-11 items-center text-sm text-muted-foreground">
                          {capture?.label.toLowerCase()}
                        </p>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        className="ml-auto"
                        onClick={() => remove(line.key)}
                        aria-label={`Quitar ${line.product.name} (línea ${index + 1})`}
                      >
                        <Trash2 aria-hidden="true" data-icon="inline-start" />
                        Quitar
                      </Button>
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
          id="notas-cotizacion"
          label="Notas para el cliente (opcional)"
          error={state.fieldErrors.notes}
        >
          {(control) => (
            <textarea
              {...control}
              name="notes"
              data-field="notes"
              key={`notes-${state.answers}`}
              defaultValue={draft.notes}
              rows={3}
              maxLength={1000}
              placeholder="Entrega en obra, forma de pago, tiempos…"
              className={areaClass}
            />
          )}
        </FormField>
      </div>

      <div className="space-y-4 lg:sticky lg:top-6">
        <section
          aria-labelledby="total-cotizacion"
          className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"
        >
          <h2 id="total-cotizacion" className="font-medium">
            Total
          </h2>
          <dl className="space-y-1 text-sm tabular-nums">
            {preview?.discount && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Descuento</dt>
                <dd>{preview.discount}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                {preview?.taxLabel ?? "IVA"}
              </dt>
              <dd>{preview?.tax ?? "…"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t pt-2">
              <dt className="font-medium">Total</dt>
              <dd className="text-2xl font-semibold">
                {preview?.total ?? "…"}
              </dd>
            </div>
          </dl>
          {previewError && (
            <p className="text-sm text-destructive">{previewError}</p>
          )}

          <FormField
            id="vigencia-cotizacion"
            label="Vale hasta"
            error={state.fieldErrors.validUntil}
          >
            {(control) => (
              <Input
                {...control}
                name="validUntil"
                data-field="validUntil"
                type="date"
                key={`valid-${state.answers}`}
                defaultValue={draft.validUntil}
              />
            )}
          </FormField>

          <details
            className="group"
            open={
              draft.discountPercent !== "" ||
              Boolean(
                state.fieldErrors.discountPercent ||
                state.fieldErrors.discountReason,
              )
            }
          >
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-lg text-sm font-medium text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              Aplicar descuento
            </summary>
            <div className="mt-2 space-y-3">
              <FormField
                id="descuento-cotizacion"
                label="Descuento (%)"
                error={
                  state.fieldErrors.discountPercent ?? preview?.discountError
                }
              >
                {(control) => (
                  <Input
                    {...control}
                    name="discountPercent"
                    data-field="discountPercent"
                    value={discountPercent}
                    onChange={(event) => setDiscountPercent(event.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={6}
                    className="tabular-nums"
                  />
                )}
              </FormField>
              <FormField
                id="motivo-descuento-cotizacion"
                label="Motivo"
                error={state.fieldErrors.discountReason}
              >
                {(control) => (
                  <Input
                    {...control}
                    name="discountReason"
                    data-field="discountReason"
                    key={`reason-${state.answers}`}
                    defaultValue={draft.discountReason}
                    maxLength={200}
                    autoComplete="off"
                    placeholder="Mayoreo"
                  />
                )}
              </FormField>
            </div>
          </details>

          {terms.length > 0 && (
            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-medium">
                Forma de pago
              </legend>
              <input type="hidden" name="planMonths" value={planMonths} />
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "", label: "Contado" },
                  { value: planMonths || terms[0]!.value, label: "A plazos" },
                ].map((option) => {
                  const checked =
                    option.value === "" ? planMonths === "" : planMonths !== "";
                  return (
                    <label
                      key={option.label}
                      className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border bg-card px-3 text-sm font-medium has-checked:border-primary has-checked:bg-primary/5 has-checked:text-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                    >
                      <input
                        type="radio"
                        name="planMode"
                        className="sr-only"
                        checked={checked}
                        onChange={() => setPlanMonths(option.value)}
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
              {planMonths !== "" && (
                <>
                  <div className="space-y-1">
                    <label
                      htmlFor="plazo-cotizacion"
                      className="text-sm font-medium"
                    >
                      Plazo
                    </label>
                    <NativeSelect
                      id="plazo-cotizacion"
                      data-field="planMonths"
                      key={`plan-${state.answers}`}
                      defaultValue={planMonths}
                      onChange={(event) => setPlanMonths(event.target.value)}
                      aria-invalid={Boolean(planMonthsError)}
                      aria-describedby={
                        planMonthsError ? "plazo-cotizacion-error" : undefined
                      }
                    >
                      {terms.map((term) => (
                        <option key={term.value} value={term.value}>
                          {term.label}
                        </option>
                      ))}
                    </NativeSelect>
                    {planMonthsError && (
                      <p
                        id="plazo-cotizacion-error"
                        className="text-sm text-destructive"
                      >
                        {planMonthsError}
                      </p>
                    )}
                  </div>
                  <FormField
                    id="enganche-cotizacion"
                    label="Enganche ($)"
                    error={planDownError}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        name="planDownPayment"
                        data-field="planDownPayment"
                        value={planDown}
                        onChange={(event) => setPlanDown(event.target.value)}
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={16}
                        className="tabular-nums"
                      />
                    )}
                  </FormField>
                  {preview?.plan && (
                    <dl
                      className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm tabular-nums"
                      aria-live="polite"
                    >
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">
                          {preview.plan.months} mensualidades
                        </dt>
                        <dd className="font-medium">
                          {preview.plan.installment}
                        </dd>
                      </div>
                      {preview.plan.lastInstallment && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted-foreground">La última</dt>
                          <dd>{preview.plan.lastInstallment}</dd>
                        </div>
                      )}
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Interés</dt>
                        <dd>{preview.plan.interest}</dd>
                      </div>
                      <div className="flex justify-between gap-3 border-t pt-1">
                        <dt className="font-medium">Total a plazos</dt>
                        <dd className="font-medium">
                          {preview.plan.totalToPay}
                        </dd>
                      </div>
                    </dl>
                  )}
                </>
              )}
            </fieldset>
          )}

          <div className="flex flex-col gap-2">
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              Guardar cotización
            </Button>
            <Button asChild variant="outline">
              <Link href={cancelHref}>Cancelar</Link>
            </Button>
          </div>
        </section>
      </div>
    </form>
  );
}
