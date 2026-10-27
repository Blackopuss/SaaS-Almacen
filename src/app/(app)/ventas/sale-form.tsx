"use client";

import {
  CircleAlert,
  Loader2,
  PackageSearch,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  findSaleProductsAction,
  loadSaleProductAction,
  quoteSaleAction,
  type SaleCustomer,
} from "./actions";
import { CustomerPicker } from "./customer-picker";
import type { CartQuote, SaleProduct, SaleSearch } from "@/modules/sales";

type Line = {
  /** Identity of the row on screen; the server ignores it. */
  key: string;
  product: SaleProduct;
  quantity: string;
  /** "base" or "p:<presentation id>". */
  capture: string;
  locationId: string;
};

type Candidate = SaleSearch["candidates"][number];

/**
 * The counter (VEN-06): products are added one after another — typed or
 * scanned — and the cart shows what each line costs and what the sale
 * adds up to. Every amount comes from the server.
 */
export function SaleForm({
  maxLines,
  canCreateCustomer,
  canPickCustomer,
}: {
  maxLines: number;
  canCreateCustomer: boolean;
  canPickCustomer: boolean;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [quote, setQuote] = useState<CartQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<SaleCustomer | null>(null);

  // A reader types faster than the server answers (INV-29): answers change
  // the list as of the last change, not the one that started the search.
  const latest = useRef<Line[] | null>(null);
  const current = () => latest.current ?? lines;
  function commit(next: Line[]) {
    latest.current = next;
    setLines(next);
  }

  function add(product: SaleProduct) {
    const now = current();
    if (product.captures.length === 0) {
      setNotice(
        `${product.name} no tiene precio de venta. Pide que se lo pongan en Inventario.`,
      );
      return;
    }
    if (product.locations.length === 0) {
      setNotice(`No hay ${product.name} en existencia.`);
      return;
    }
    // Scanned again: one more of the same, when it goes by whole units.
    const again = now.find(
      (line) =>
        line.product.id === product.id &&
        line.capture === product.captures[0]!.value &&
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
        `Una venta admite hasta ${maxLines} líneas. Cobra esta y sigue en otra.`,
      );
      return;
    }
    commit([
      ...now,
      {
        key: `l${nextKey.current++}`,
        product,
        quantity: "1",
        capture: product.captures[0]!.value,
        locationId: product.locations[0]!.id,
      },
    ]);
    setNotice(`Agregaste ${product.name}.`);
  }

  // Codes wait in line (INV-29): none may be lost or change places.
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
          const found = await findSaleProductsAction(typed);
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
  async function choose(candidate: Candidate) {
    setChoosing(true);
    try {
      const product = await loadSaleProductAction(candidate.id);
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
  }

  function remove(key: string) {
    commit(current().filter((line) => line.key !== key));
    searchRef.current?.focus();
  }

  // Prices and totals come from the server, a moment after the last change;
  // an answer to an older cart is ignored.
  const payload = JSON.stringify(
    lines.map((line) => ({
      productId: line.product.id,
      capture: line.capture,
      quantity: line.quantity,
      locationId: line.locationId,
    })),
  );
  const asked = useRef(0);
  useEffect(() => {
    const ticket = ++asked.current;
    const timer = setTimeout(async () => {
      try {
        const answer = await quoteSaleAction(JSON.parse(payload));
        if (ticket !== asked.current) return;
        if ("error" in answer) {
          setQuote(null);
          setQuoteError(answer.error);
        } else {
          setQuote(answer);
          setQuoteError(null);
        }
      } catch {
        if (ticket === asked.current) {
          setQuoteError(
            "No pudimos calcular el total. Revisa tu conexión; se intentará de nuevo al cambiar algo.",
          );
        }
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [payload]);

  const fresh = quote !== null && quote.lines.length === lines.length;
  const units = lines.length === 1 ? "1 producto" : `${lines.length} productos`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="min-w-0 space-y-6">
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
                      <span className="block font-medium">
                        {candidate.name}
                      </span>
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

        <section
          aria-labelledby="carrito"
          className="rounded-xl border bg-card"
        >
          <div className="flex items-baseline justify-between gap-3 border-b p-4 sm:px-5">
            <h2 id="carrito" className="font-medium">
              Lo que se lleva
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {units}
            </p>
          </div>
          {lines.length === 0 ? (
            <div className="flex items-start gap-3 p-4 text-sm text-muted-foreground sm:px-5">
              <PackageSearch aria-hidden="true" className="size-5 shrink-0" />
              <p>Busca o escanea un producto. Puedes agregar varios.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {lines.map((line, index) => {
                const priced = fresh ? quote.lines[index] : undefined;
                const error = priced?.error;
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
                          onKeyDown={(event) => {
                            // Enter goes back to the search box.
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
                            En qué se vende {line.product.name}
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
      </div>

      <div className="space-y-4 lg:sticky lg:top-6">
        {canPickCustomer && (
          <section
            aria-labelledby="cliente-venta"
            className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
          >
            <h2 id="cliente-venta" className="font-medium">
              Cliente
            </h2>
            <CustomerPicker
              value={customer}
              onChange={setCustomer}
              canCreate={canCreateCustomer}
            />
          </section>
        )}
        <section
          aria-labelledby="total-venta"
          className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
        >
          <h2 id="total-venta" className="font-medium">
            Total
          </h2>
          {quoteError && (
            <p role="alert" className="text-sm text-destructive">
              {quoteError}
            </p>
          )}
          <dl className="space-y-1 text-sm tabular-nums">
            {quote && !quote.pricesIncludeTax && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{quote.subtotal}</dd>
              </div>
            )}
            {quote && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{quote.taxLabel}</dt>
                <dd>{quote.tax}</dd>
              </div>
            )}
            <div
              className="flex items-baseline justify-between gap-3 border-t pt-2"
              aria-live="polite"
            >
              <dt className="font-medium">A cobrar</dt>
              <dd className="text-2xl font-semibold">
                {quote?.total ?? "$0.00"}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
