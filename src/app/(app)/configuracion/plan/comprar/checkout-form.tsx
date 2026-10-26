"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  checkoutAction,
  type CheckoutState,
  type CheckoutValues,
} from "./actions";
import type { ShownQuote } from "./quotes";

export type TierCard = {
  id: string;
  /** «1,000», already written for Mexico. */
  products: string;
  users: number;
  /** What Compras adds per month, «$299.00». */
  purchasingMonthly: string;
};

const key = (tier: string, months: string, purchasing: boolean) =>
  `${tier}:${months}:${purchasing ? 1 : 0}`;
/** Same shape the server gives a code («pepito gratis» → «PEPITOGRATIS»). */
const asCode = (text: string) => text.replace(/\s+/g, "").toUpperCase();

/**
 * The checkout of a plan: tier (a carousel on phones), Compras, months,
 * code and how to pay. Every amount is looked up in what the server
 * priced; the browser never adds or multiplies.
 */
export function CheckoutForm({
  tiers,
  months,
  quotes,
  providers,
  refundTerms,
  initial,
  lockPurchasing = false,
}: {
  /** Renewal of a live plan: Compras stays as it is. */
  lockPurchasing?: boolean;
  tiers: TierCard[];
  months: number[];
  quotes: Record<string, ShownQuote>;
  providers: { id: string; label: string }[];
  refundTerms: string[];
  initial: CheckoutValues;
}) {
  const [state, formAction] = useActionState(checkoutAction, {
    fieldErrors: {},
    answers: 0,
  } satisfies CheckoutState);
  // Busy from a submit until the next answer; a redirect brings none.
  const [sentAt, setSentAt] = useState<number | null>(null);
  const busy = sentAt === state.answers;

  return (
    <form
      action={formAction}
      noValidate
      onSubmit={(event) => {
        if (busy) event.preventDefault();
        else setSentAt(state.answers);
      }}
    >
      <Choices
        key={state.answers}
        state={state}
        values={state.values ?? initial}
        tiers={tiers}
        months={months}
        quotes={quotes}
        providers={providers}
        refundTerms={refundTerms}
        busy={busy}
        lockPurchasing={lockPurchasing}
      />
    </form>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      {children}
    </div>
  );
}

function Choices({
  state,
  values,
  tiers,
  months,
  quotes,
  providers,
  refundTerms,
  busy,
  lockPurchasing,
}: {
  lockPurchasing: boolean;
  state: CheckoutState;
  values: CheckoutValues;
  tiers: TierCard[];
  months: number[];
  quotes: Record<string, ShownQuote>;
  providers: { id: string; label: string }[];
  refundTerms: string[];
  busy: boolean;
}) {
  const [tier, setTier] = useState(values.tier);
  const [length, setLength] = useState(values.months || "1");
  const [purchasing, setPurchasing] = useState(values.purchasing);
  const [codeText, setCodeText] = useState(values.code);

  const applied =
    state.applied && asCode(codeText) === state.applied.code
      ? state.applied
      : null;
  const shown = (applied?.quotes ?? quotes)[key(tier, length, purchasing)];
  const chosenTier = tiers.find((t) => t.id === tier) ?? tiers[0];
  const errors = state.fieldErrors;
  const root = useRef<HTMLDivElement>(null);
  // Remounted with every answer: take the person to what was rejected.
  useEffect(() => {
    const first = errors.code
      ? "#code"
      : errors.provider
        ? "[name=provider]"
        : null;
    if (first) root.current?.querySelector<HTMLElement>(first)?.focus();
  }, [errors.code, errors.provider]);

  return (
    <div
      ref={root}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <div className="min-w-0 space-y-6">
        {state.formError && <Alert>{state.formError}</Alert>}

        <fieldset className="min-w-0 space-y-3">
          <legend className="text-lg font-semibold">Plan</legend>
          <p className="text-sm text-muted-foreground">
            Cada plan incluye Inventario. Precios al mes, más IVA.
          </p>
          {errors.tier && (
            <p className="text-sm text-destructive">{errors.tier}</p>
          )}
          {/* Carousel on phones (scroll-snap), a row from lg up. */}
          <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:-mx-0 sm:scroll-px-0 sm:px-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:pb-0">
            {tiers.map((each) => {
              const price = quotes[key(each.id, "1", purchasing)];
              return (
                <label
                  key={each.id}
                  className="flex w-[72%] shrink-0 cursor-pointer snap-start flex-col gap-3 rounded-xl border bg-card p-4 transition-colors has-checked:border-primary has-checked:bg-primary/5 has-checked:ring-1 has-checked:ring-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:w-[40%] lg:w-auto"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xl font-semibold tracking-tight tabular-nums">
                      {each.products}
                    </span>
                    <input
                      type="radio"
                      name="tier"
                      value={each.id}
                      defaultChecked={each.id === tier}
                      onChange={() => setTier(each.id)}
                      className="size-5 shrink-0 accent-primary"
                    />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <span className="block">productos activos</span>
                    <span className="block">{each.users} usuarios</span>
                  </span>
                  <span className="mt-auto">
                    <span className="text-lg font-semibold tabular-nums">
                      {price?.monthly}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      al mes
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {lockPurchasing ? (
          purchasing && <input type="hidden" name="purchasing" value="1" />
        ) : (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
            <input
              type="checkbox"
              name="purchasing"
              value="1"
              defaultChecked={purchasing}
              onChange={(event) => setPurchasing(event.currentTarget.checked)}
              className="mt-0.5 size-5 accent-primary"
            />
            <span>
              <span className="block font-medium">
                Agregar Compras{" "}
                <span className="font-normal text-muted-foreground tabular-nums">
                  (+{chosenTier?.purchasingMonthly} al mes)
                </span>
              </span>
              <span className="block text-sm text-muted-foreground">
                Proveedores, órdenes de compra, recepciones y sugerencias de
                compra.
              </span>
            </span>
          </label>
        )}

        <fieldset className="space-y-3">
          <legend className="text-lg font-semibold">¿Por cuántos meses?</legend>
          {errors.months && (
            <p className="text-sm text-destructive">{errors.months}</p>
          )}
          <div className="grid grid-cols-4 gap-1 rounded-xl border bg-muted p-1 sm:inline-grid">
            {months.map((each) => (
              <label
                key={each}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors has-checked:bg-card has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:px-4"
              >
                <input
                  type="radio"
                  name="months"
                  value={each}
                  defaultChecked={String(each) === length}
                  onChange={() => setLength(String(each))}
                  className="sr-only"
                />
                {each} {each === 1 ? "mes" : "meses"}
              </label>
            ))}
          </div>
        </fieldset>

        <FormField
          id="code"
          label="¿Tienes un código?"
          error={errors.code}
          hint={
            applied
              ? undefined
              : "Si te dieron un código de descuento, escríbelo y aplícalo."
          }
        >
          {(control) => (
            <div className="flex gap-2 sm:max-w-md">
              <Input
                {...control}
                name="code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={60}
                defaultValue={values.code}
                onChange={(event) => setCodeText(event.currentTarget.value)}
              />
              <Button
                type="submit"
                name="intent"
                value="apply"
                variant="outline"
                disabled={busy}
              >
                Aplicar
              </Button>
            </div>
          )}
        </FormField>
        {applied && (
          <p
            role="status"
            className="-mt-4 flex items-center gap-1.5 text-sm text-success"
          >
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
            Código {applied.code}:{" "}
            {applied.percentOff === 100
              ? "tu compra es gratis"
              : `${applied.percentOff}% de descuento`}
          </p>
        )}

        <details className="rounded-xl border bg-card text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center rounded-xl px-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-5">
            Condiciones de reembolso
          </summary>
          <div className="space-y-2 border-t p-4 text-muted-foreground sm:px-5">
            <ul className="list-disc space-y-1 pl-5">
              {refundTerms.map((term) => (
                <li key={term}>{term}</li>
              ))}
            </ul>
            <p>
              Consulta los{" "}
              <Link
                href="/terminos"
                className="font-medium text-foreground underline underline-offset-4"
              >
                términos y condiciones
              </Link>
              .
            </p>
          </div>
        </details>
      </div>

      <aside
        aria-labelledby="resumen"
        className="space-y-4 rounded-xl border bg-card p-4 sm:p-5 lg:sticky lg:top-20"
      >
        <h2 id="resumen" className="text-lg font-semibold">
          Resumen
        </h2>
        <dl aria-live="polite" className="space-y-2 text-sm tabular-nums">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {chosenTier?.products} productos
              {purchasing ? " + Compras" : ""} · {length}{" "}
              {length === "1" ? "mes" : "meses"}
            </dt>
            <dd>{shown?.subtotal}</dd>
          </div>
          {shown?.discount && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Descuento</dt>
              <dd>−{shown.discount}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">IVA 16%</dt>
            <dd>{shown?.tax}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd>{shown?.total} MXN</dd>
          </div>
        </dl>

        {shown?.free ? (
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
            Activar plan gratis
          </Button>
        ) : providers.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">¿Cómo quieres pagar?</p>
            {providers.map((provider, index) => (
              <Button
                key={provider.id}
                type="submit"
                name="provider"
                value={provider.id}
                variant={index === 0 ? "default" : "outline"}
                className="h-auto min-h-11 w-full py-2 whitespace-normal"
                disabled={busy}
              >
                {provider.label}
              </Button>
            ))}
            {errors.provider && (
              <p className="text-sm text-destructive">{errors.provider}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Pagas en la página segura del proveedor; nosotros no vemos tu
              tarjeta.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            El pago en línea todavía no está disponible. Si tienes un código,
            aplícalo arriba; si no, escríbenos y activamos tu plan al confirmar
            tu transferencia.
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            Un momento…
          </p>
        )}
      </aside>
    </div>
  );
}
