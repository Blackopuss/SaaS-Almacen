"use client";

import { Loader2, ShoppingCart } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { generateSuggestedOrdersAction, type SuggestState } from "./actions";

/**
 * Creates the suggested draft for one supplier. Sends only the ids of the
 * products; the server works out the rest again.
 */
export function SuggestButton({
  productIds,
  label,
}: {
  productIds: string[];
  /** «Crear borrador para Ferretera del Norte». */
  label: string;
}) {
  const [state, formAction, busy] = useActionState(
    generateSuggestedOrdersAction,
    { answers: 0 } satisfies SuggestState,
  );
  return (
    <form action={formAction} className="space-y-2">
      {productIds.map((id) => (
        <input key={id} type="hidden" name="productId" value={id} />
      ))}
      <Button type="submit" disabled={busy}>
        {busy ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <ShoppingCart aria-hidden="true" data-icon="inline-start" />
        )}
        {busy ? "Creando borrador…" : label}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
