"use client";

import { CircleAlert, Loader2, Undo2 } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  checkReturnAction,
  returnToSupplierAction,
  type ReturnFormState,
} from "../actions";

/** A received line that may still go back, as the server describes it. */
export type ReturnableLine = {
  id: string;
  productName: string;
  sku: string;
  /** «llegaron 3 cajas · puedes devolver 2 cajas». */
  detail: string;
  /** «cajas», «piezas». */
  unitText: string;
  /** Where it was received: where it is taken from by default. */
  locationId: string;
};

const areaClass =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

/**
 * Sends back to the supplier part of what a receipt brought (CMP-12):
 * each product starts empty (nothing goes back unless written), asks why
 * and confirms once even if the button is pressed twice or the answer is
 * lost.
 */
export function ReturnReceipt({
  orderId,
  receiptId,
  receiptText,
  idempotencyKey,
  lines,
  locations,
}: {
  orderId: string;
  receiptId: string;
  /** «la recepción del 15 oct 2026, 7:51 p.m.». */
  receiptText: string;
  /** Created by the server when the page is drawn. */
  idempotencyKey: string;
  lines: ReturnableLine[];
  locations: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, busy] = useActionState(
    async (prev: ReturnFormState, formData: FormData) => {
      let next: ReturnFormState;
      try {
        next = await returnToSupplierAction(orderId, receiptId, prev, formData);
      } catch (error) {
        unstable_rethrow(error);
        // No answer arrived: find out whether the return was registered
        // before letting the person send it again (INV-22).
        let returned = false;
        try {
          returned = (
            await checkReturnAction(String(formData.get("idempotencyKey")))
          ).returned;
        } catch {
          returned = false;
        }
        next = returned
          ? {
              ...prev,
              fieldErrors: {},
              done: "La devolución quedó registrada.",
            }
          : {
              ...prev,
              fieldErrors: {},
              formError:
                "No pudimos confirmar si se registró: revisa tu conexión y vuelve a intentar. No se devolverá dos veces.",
            };
      }
      if (next.done) {
        toast.success(next.done);
        setOpen(false);
      }
      return { ...next, answers: prev.answers + 1 };
    },
    {
      fieldErrors: {},
      values: { reason: "", quantities: {}, places: {} },
      answers: 0,
    },
  );
  const { answers } = state;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Undo2 aria-hidden="true" data-icon="inline-start" />
          Devolver al proveedor
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="contents">
          <DialogHeader>
            <DialogTitle>Devolver al proveedor</DialogTitle>
            <DialogDescription>
              Escribe cuánto regresa de cada producto de {receiptText}. Sale del
              inventario con el contenido que tenía cada caja al recibirla. La
              orden no vuelve a esperarlo: si lo sigues necesitando, pídelo en
              otra orden.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <ul className="max-h-[40vh] divide-y overflow-y-auto rounded-lg border">
            {lines.map((line) => {
              const fieldId = `return-q-${line.id}`;
              const error = state.lineErrors?.[line.id];
              return (
                <li
                  key={line.id}
                  className="grid gap-2 p-3 sm:grid-cols-[1fr_9rem] sm:items-center"
                >
                  <label htmlFor={fieldId} className="min-w-0 text-sm">
                    <span className="block font-medium [overflow-wrap:anywhere]">
                      {line.productName}
                    </span>
                    <span className="text-muted-foreground">
                      {line.sku} · {line.detail}
                    </span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      key={`${line.id}-${answers}`}
                      id={fieldId}
                      name={`q:${line.id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0"
                      defaultValue={state.values.quantities[line.id] ?? ""}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? `${fieldId}-error` : undefined}
                      className="tabular-nums"
                    />
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {line.unitText}
                    </span>
                  </div>
                  {locations.length > 1 && (
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <label
                        htmlFor={`${fieldId}-place`}
                        className="shrink-0 text-sm text-muted-foreground"
                      >
                        Sale de
                      </label>
                      <div className="min-w-0 flex-1">
                        <NativeSelect
                          key={`${line.id}-place-${answers}`}
                          id={`${fieldId}-place`}
                          name={`l:${line.id}`}
                          defaultValue={
                            state.values.places[line.id] ?? line.locationId
                          }
                        >
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                    </div>
                  )}
                  {error && (
                    <p
                      id={`${fieldId}-error`}
                      className="text-sm text-destructive sm:col-span-2"
                    >
                      {error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {state.formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
              <p>{state.formError}</p>
            </div>
          )}
          <FormField
            id={`return-reason-${receiptId}`}
            label="¿Por qué se devuelve?"
            error={state.fieldErrors.reason}
          >
            {(control) => (
              <textarea
                key={`reason-${answers}`}
                name="reason"
                rows={2}
                maxLength={300}
                placeholder="Por ejemplo: llegó dañado."
                defaultValue={state.values.reason}
                className={areaClass}
                {...control}
              />
            )}
          </FormField>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Todavía no
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
              {busy ? "Devolviendo…" : "Confirmar devolución"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
