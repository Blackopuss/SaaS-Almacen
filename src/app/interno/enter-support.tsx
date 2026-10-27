"use client";

import { LogIn } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { enterSupportAction } from "./empresas/[id]/actions";

/** Enters a company as support (PIL-12); says why when it cannot. */
export function EnterSupport({
  organizationId,
  name,
}: {
  organizationId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(
    async () => enterSupportAction(organizationId),
    { error: "" },
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        aria-label={`Entrar a ${name} como soporte`}
      >
        <LogIn aria-hidden="true" data-icon="inline-start" />
        Entrar como soporte
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  );
}
