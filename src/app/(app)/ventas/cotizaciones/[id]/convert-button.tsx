"use client";

import { Loader2, PackageCheck } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { convertQuoteAction, type ConvertQuoteState } from "../actions";

/** «Hacer pedido» of an accepted quote (COT-05); the server opens the order. */
export function ConvertQuoteButton({ quoteId }: { quoteId: string }) {
  const [state, formAction, pending] = useActionState(
    () => convertQuoteAction(quoteId),
    {} as ConvertQuoteState,
  );
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <PackageCheck aria-hidden="true" data-icon="inline-start" />
        )}
        Hacer pedido
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
