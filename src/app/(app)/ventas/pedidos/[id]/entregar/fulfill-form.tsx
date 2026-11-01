"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  FulfillmentLineView,
  FulfillmentPreview,
  QuotePlanView,
} from "@/modules/sales";

import { checkSaleAction } from "../../../actions";
import {
  PaymentPanel,
  type Method,
  type PayMode,
  type PaymentRow,
} from "../../../payment-panel";
import {
  fulfillOrderAction,
  previewFulfillmentAction,
  type FulfillFormState,
} from "./actions";

type Answer = FulfillFormState & { answers: number; payments: string };

const EMPTY: Answer = {
  lineErrors: {},
  paymentErrors: {},
  answers: 0,
  payments: "",
};

/**
 * What is delivered now of an order and how it is paid (COT-08). Amounts,
 * totals and change come from the server; a lost answer is checked by its
 * key, never charged again blindly.
 */
export function FulfillForm({
  orderId,
  lines,
  idempotencyKey,
  maxPayments,
  plan,
}: {
  orderId: string;
  lines: FulfillmentLineView[];
  idempotencyKey: string;
  maxPayments: number;
  /** On installments (PAG-04): delivered whole, charging the down payment. */
  plan: QuotePlanView | null;
}) {
  const router = useRouter();
  const [key] = useState(idempotencyKey);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.id,
        line.suggested === "0" ? "" : line.suggested,
      ]),
    ),
  );
  const [places, setPlaces] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((line) => [line.id, line.locations[0]?.id ?? ""]),
    ),
  );
  const [mode, setMode] = useState<PayMode>("CASH");
  const [single, setSingle] = useState({ received: "", reference: "" });
  const nextPayment = useRef(1);
  const newRow = (method: Method): PaymentRow => ({
    key: `p${nextPayment.current++}`,
    method,
    amount: "",
    received: "",
    reference: "",
  });
  const [rows, setRows] = useState<PaymentRow[]>(() => [
    { key: "p-cash", method: "CASH", amount: "", received: "", reference: "" },
    { key: "p-card", method: "CARD", amount: "", received: "", reference: "" },
  ]);
  const [preview, setPreview] = useState<FulfillmentPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [lost, setLost] = useState<"checking" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const sentPayments =
    mode === "MIXED"
      ? rows.map(({ method, amount, received, reference }) => ({
          method,
          amount,
          received: method === "CASH" ? received : "",
          reference: method === "CASH" ? "" : reference,
        }))
      : [
          {
            method: mode,
            amount: "",
            received: mode === "CASH" ? single.received : "",
            reference: mode === "CASH" ? "" : single.reference,
          },
        ];
  const paymentsPayload = JSON.stringify(sentPayments);
  const payload = JSON.stringify(
    lines.map((line) => ({
      orderLineId: line.id,
      quantity: quantities[line.id] ?? "",
      locationId: places[line.id] ?? "",
    })),
  );

  // Totals come from the server a moment after the last change; an answer
  // about older quantities is ignored.
  const asked = useRef(0);
  useEffect(() => {
    const ticket = ++asked.current;
    const timer = setTimeout(async () => {
      try {
        const answer = await previewFulfillmentAction(
          orderId,
          JSON.parse(payload),
          JSON.parse(paymentsPayload),
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
  }, [orderId, payload, paymentsPayload]);

  const [state, formAction, pending] = useActionState(
    async (prev: Answer, formData: FormData): Promise<Answer> => {
      const payments = String(formData.get("payments") ?? "");
      try {
        const next = await fulfillOrderAction(orderId, prev, formData);
        return { ...next, answers: prev.answers + 1, payments };
      } catch (error) {
        unstable_rethrow(error);
        setLost("checking");
        for (const wait of [0, 1500, 3000, 6000]) {
          if (wait > 0) await new Promise((done) => setTimeout(done, wait));
          try {
            const found = await checkSaleAction(key);
            setLost(null);
            if (found) {
              // It was charged: the answer got lost on the way back.
              router.push(`/ventas/${found.saleId}?entrega=1`);
              return prev;
            }
            return {
              ...EMPTY,
              answers: prev.answers + 1,
              formError:
                "Se perdió la conexión y la entrega no se registró. Puedes cobrarla de nuevo: no se duplicará.",
            };
          } catch {
            // Still unreachable: wait and ask again.
          }
        }
        setLost(null);
        return {
          ...EMPTY,
          answers: prev.answers + 1,
          formError:
            "Se perdió la conexión y no sabemos si la entrega quedó cobrada. Revisa el pedido antes de cobrar otra vez.",
        };
      }
    },
    EMPTY,
  );

  useEffect(() => {
    const form = formRef.current;
    if (!form || state.answers === 0) return;
    const line = lines.find((l) => state.lineErrors[l.id]);
    if (line) form.querySelector<HTMLElement>(`#entregar-${line.id}`)?.focus();
    else form.querySelector<HTMLElement>("[data-form-error]")?.focus();
  }, [state, lines]);

  // Payment errors: by position for one payment, by row key for several;
  // only while the payments are the ones that were sent.
  const paymentErrors: Record<string, string> =
    state.payments !== paymentsPayload
      ? {}
      : mode === "MIXED"
        ? Object.fromEntries(
            Object.entries(state.paymentErrors).flatMap(([index, error]) => {
              const row = rows[Number(index)];
              return row ? [[row.key, error]] : [];
            }),
          )
        : Object.fromEntries(Object.entries(state.paymentErrors));

  const going = preview ? Object.keys(preview.lines).length : 0;
  const blocked =
    preview === null ||
    going === 0 ||
    Object.keys(preview.lineErrors).length > 0 ||
    Object.values(preview.lines).some((line) => line.error);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start"
    >
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="lines" value={payload} />
      <input type="hidden" name="payments" value={paymentsPayload} />
      <section
        aria-labelledby="entregar-productos"
        className="min-w-0 rounded-xl border bg-card"
      >
        <h2
          id="entregar-productos"
          className="border-b p-4 font-medium sm:px-5"
        >
          ¿Qué se entrega ahora?
        </h2>
        <ul className="divide-y">
          {lines.map((line) => {
            const id = `entregar-${line.id}`;
            const error =
              state.lineErrors[line.id] ??
              preview?.lineErrors[line.id] ??
              preview?.lines[line.id]?.error;
            const amount = preview?.lines[line.id]?.amount;
            return (
              <li
                key={line.id}
                className="grid gap-3 p-4 sm:grid-cols-[1fr_11rem] sm:px-5"
              >
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {line.productName}
                  </p>
                  <p className="text-muted-foreground">
                    Pedido: {line.orderedText} × {line.unitPrice}
                  </p>
                  <p className="text-muted-foreground">
                    Falta: {line.missingText}
                  </p>
                  {line.locations.length === 0 && (
                    <p className="font-medium">
                      No hay existencias: queda pendiente.
                    </p>
                  )}
                  {amount && (
                    <p className="font-medium tabular-nums">{amount}</p>
                  )}
                </div>
                <div className="space-y-2">
                  {plan ? (
                    <div className="space-y-1">
                      <p className="text-sm">
                        Se entrega:{" "}
                        <span className="font-medium">{line.missingText}</span>
                      </p>
                      {error && (
                        <p className="text-sm text-destructive">{error}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label htmlFor={id}>
                        <span className="sr-only">{line.productName}: </span>
                        Entregar ahora
                      </Label>
                      <Input
                        id={id}
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={20}
                        placeholder="0"
                        defaultValue={quantities[line.id]}
                        key={`q-${line.id}-${state.answers}`}
                        onChange={(event) =>
                          setQuantities({
                            ...quantities,
                            [line.id]: event.target.value,
                          })
                        }
                        aria-invalid={Boolean(error)}
                        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
                        className="tabular-nums"
                      />
                      <p
                        id={`${id}-hint`}
                        className="text-sm text-muted-foreground"
                      >
                        En {line.unitLabel}
                      </p>
                      {error && (
                        <p
                          id={`${id}-error`}
                          className="text-sm text-destructive"
                        >
                          {error}
                        </p>
                      )}
                    </div>
                  )}
                  {line.locations.length > 1 && (
                    <div className="space-y-1">
                      <Label htmlFor={`${id}-lugar`}>Sale de</Label>
                      <NativeSelect
                        id={`${id}-lugar`}
                        defaultValue={places[line.id]}
                        key={`l-${line.id}-${state.answers}`}
                        onChange={(event) =>
                          setPlaces({
                            ...places,
                            [line.id]: event.target.value,
                          })
                        }
                      >
                        {line.locations.map((place) => (
                          <option key={place.id} value={place.id}>
                            {place.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  )}
                  {line.locations.length === 1 && (
                    <p className="text-sm text-muted-foreground">
                      {line.locations[0]!.label}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="entregar-total"
        className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
      >
        <h2 id="entregar-total" className="font-medium">
          Total
        </h2>
        {previewError && (
          <p role="alert" className="text-sm text-destructive">
            {previewError}
          </p>
        )}
        <dl className="space-y-1 text-sm tabular-nums">
          {preview?.discount && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                Descuento · {preview.discount.reason}
              </dt>
              <dd>{preview.discount.text}</dd>
            </div>
          )}
          {preview && (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd>{preview.subtotal}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{preview.taxLabel}</dt>
                <dd>{preview.tax}</dd>
              </div>
            </>
          )}
          <div
            className="flex items-baseline justify-between gap-3 border-t pt-2"
            aria-live="polite"
          >
            <dt className="font-medium">
              {plan ? "Total de la venta" : "A cobrar"}
            </dt>
            <dd className={plan ? "font-medium" : "text-2xl font-semibold"}>
              {preview?.total ?? "$0.00"}
            </dd>
          </div>
          {plan && (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-medium">Enganche, se cobra hoy</dt>
                <dd className="text-2xl font-semibold">
                  {preview?.charge ?? plan.downPayment}
                </dd>
              </div>
              <div className="flex justify-between gap-3 text-muted-foreground">
                <dt>
                  Después, {plan.months} mensualidades ({plan.interestText})
                </dt>
                <dd>{plan.installment}</dd>
              </div>
            </>
          )}
        </dl>
        {preview?.paymentNote && (
          <p
            className="text-right text-lg font-semibold tabular-nums"
            aria-live="polite"
          >
            {preview.paymentNote}
          </p>
        )}
        <div className="space-y-4 border-t pt-4">
          <PaymentPanel
            mode={mode}
            onMode={setMode}
            single={single}
            onSingle={setSingle}
            rows={rows}
            onRows={setRows}
            errors={paymentErrors}
            maxPayments={maxPayments}
            newRow={newRow}
          />
          {state.formError && (
            <p
              role="alert"
              tabIndex={-1}
              data-form-error
              className="flex items-start gap-2 text-sm text-destructive outline-none"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              {state.formError}
            </p>
          )}
          {preview && going === 0 && (
            <p className="text-sm text-muted-foreground">
              Escribe cuánto entregas de al menos un producto.
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || blocked || lost !== null}
          >
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {lost === "checking"
              ? "Revisando si quedó cobrada…"
              : pending
                ? "Cobrando…"
                : !blocked && preview
                  ? `Cobrar ${preview.charge}`
                  : "Cobrar"}
          </Button>
        </div>
      </section>
    </form>
  );
}
