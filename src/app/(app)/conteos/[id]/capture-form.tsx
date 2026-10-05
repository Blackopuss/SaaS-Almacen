"use client";

import { CircleAlert, Equal, Loader2, Search, X } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { previewEntryAction } from "../../movimientos/actions";
import {
  captureCountAction,
  findCountProductsAction,
  loadCountProductAction,
  type CountProduct,
  type CountSearch,
} from "../actions";

/**
 * Capture of a count (INV-31): find the product — typed or scanned — and
 * write down how many there are, in boxes, pieces or another unit. Each
 * capture is saved at once, so nothing is lost if the screen closes.
 */
export function CaptureForm({ countId }: { countId: string }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CountSearch["candidates"]>([]);
  const [product, setProduct] = useState<CountProduct | null>(null);
  const [quantity, setQuantity] = useState("");
  const [capture, setCapture] = useState("base");
  /** «3 cajas × 100 = 300 piezas», asked to the server while typing. */
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What happened last: a saved capture or a search without results. */
  const [notice, setNotice] = useState<{
    text: string;
    warning?: boolean;
  } | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(0);

  function pick(found: CountProduct) {
    setProduct(found);
    setCandidates([]);
    setQuery("");
    setQuantity("");
    setCapture("base");
    setPreview(null);
    setError(null);
    // The box appears with this render: focus it once it exists.
    requestAnimationFrame(() => quantityRef.current?.focus());
  }

  function search(text: string) {
    const typed = text.trim();
    if (typed === "") return;
    setError(null);
    startSearch(async () => {
      try {
        const found = await findCountProductsAction(typed);
        if (found.error) {
          setNotice({ text: found.error, warning: true });
        } else if (found.exact) {
          setNotice(null);
          pick(found.exact);
        } else {
          setCandidates(found.candidates);
          setNotice(
            found.candidates.length === 0
              ? {
                  text: `No encontramos productos activos con «${typed}». Revisa cómo está escrito.`,
                  warning: true,
                }
              : null,
          );
        }
      } catch {
        setNotice({
          text: "No pudimos buscar. Revisa tu conexión e inténtalo de nuevo.",
          warning: true,
        });
      }
    });
  }

  function choose(id: string, name: string) {
    startSearch(async () => {
      try {
        const found = await loadCountProductAction(id);
        if (found) pick(found);
        else
          setNotice({ text: `${name} ya no está disponible.`, warning: true });
      } catch {
        setNotice({
          text: "No pudimos abrirlo. Revisa tu conexión.",
          warning: true,
        });
      }
    });
  }

  /** Asks for the equivalence a moment after the person stops typing. */
  function askPreview(productId: string, how: string, typed: string) {
    if (timer.current) clearTimeout(timer.current);
    const request = ++latest.current;
    setPreview(null);
    if (how === "base" || typed.trim() === "") return;
    timer.current = setTimeout(async () => {
      try {
        const result = await previewEntryAction(productId, how, typed);
        // Only the answer to what is on screen now counts.
        if (request === latest.current) {
          setPreview(result.ok ? result.preview : null);
        }
      } catch {
        // The preview is a help; saving checks everything again.
      }
    }, 300);
  }

  function save() {
    if (!product || saving) return;
    setError(null);
    startSave(async () => {
      try {
        const result = await captureCountAction(
          countId,
          product.id,
          capture,
          quantity,
        );
        if (!result.ok) {
          setError(result.error);
          if (result.field !== "productId") quantityRef.current?.focus();
          return;
        }
        setNotice({
          text: result.mixed
            ? `${result.summary} Capturaste empaques y sueltos: revisa que no se hayan contado dos veces.`
            : result.summary,
          warning: result.mixed,
        });
        latest.current++;
        setProduct(null);
        setQuantity("");
        setPreview(null);
        // Ready for the next product.
        requestAnimationFrame(() => searchRef.current?.focus());
      } catch {
        setError(
          "No pudimos guardar la captura. Revisa tu conexión e inténtalo de nuevo.",
        );
      }
    });
  }

  const chosen =
    product?.captures.find((option) => option.value === capture) ??
    product?.captures[0];

  return (
    <section
      aria-labelledby="capturar"
      className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
    >
      <h2 id="capturar" className="font-medium">
        Capturar
      </h2>
      {!product ? (
        <>
          <div className="flex max-w-xl items-center gap-2">
            <label htmlFor="buscar-contado" className="sr-only">
              Nombre, clave o código de barras del producto que contaste
            </label>
            <Input
              ref={searchRef}
              id="buscar-contado"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  search(event.currentTarget.value);
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
              onClick={() => search(query)}
              disabled={searching}
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
          {candidates.length > 0 && (
            <ul
              aria-label="Productos encontrados"
              className="max-w-xl divide-y rounded-xl border"
            >
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() => choose(candidate.id, candidate.name)}
                    disabled={searching}
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
                      Contar
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          noValidate
          className="max-w-xl space-y-3"
        >
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1">
              <span className="block font-medium [overflow-wrap:anywhere]">
                {product.name}
              </span>
              <span className="block text-sm [overflow-wrap:anywhere] text-muted-foreground">
                {product.sku}
              </span>
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Elegir otro producto"
              onClick={() => {
                setProduct(null);
                setError(null);
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="w-32">
              <label htmlFor="cantidad-contada" className="sr-only">
                Cuánto contaste de {product.name}
              </label>
              <Input
                ref={quantityRef}
                id="cantidad-contada"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  askPreview(product.id, capture, event.target.value);
                }}
                inputMode="decimal"
                autoComplete="off"
                maxLength={40}
                placeholder="Cantidad"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "captura-error" : "captura-ayuda"}
                className="tabular-nums"
              />
            </div>
            {product.captures.length > 1 && (
              <div className="min-w-36 flex-1">
                <label htmlFor="forma-contada" className="sr-only">
                  En qué lo contaste
                </label>
                <NativeSelect
                  id="forma-contada"
                  value={capture}
                  onChange={(event) => {
                    setCapture(event.target.value);
                    askPreview(product.id, event.target.value, quantity);
                  }}
                >
                  {product.captures.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <Button type="submit" disabled={saving}>
              {saving && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {saving ? "Guardando…" : "Guardar captura"}
            </Button>
          </div>
          {error ? (
            <p
              id="captura-error"
              role="alert"
              className="flex items-start gap-1.5 text-sm text-destructive"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              {error}
            </p>
          ) : (
            <p id="captura-ayuda" className="text-sm text-muted-foreground">
              {chosen?.hint} Si no hay nada, escribe 0.
            </p>
          )}
          {preview && (
            <p className="flex items-start gap-1.5 text-sm font-medium">
              <Equal aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {preview}
            </p>
          )}
        </form>
      )}
      <p
        role="status"
        className={`min-h-5 text-sm ${notice?.warning ? "text-foreground" : "text-muted-foreground"}`}
      >
        {notice?.warning && (
          <CircleAlert
            aria-hidden="true"
            className="mr-1.5 inline size-4 align-text-bottom text-warning"
          />
        )}
        {notice?.text}
      </p>
    </section>
  );
}
