"use client";

import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { sendStatementAction } from "./actions";

/**
 * «Enviar por correo» of a statement; while a mail is on its way the
 * screen asks the server again every few seconds, for a minute.
 */
export function SendStatementButton({
  customerId,
  inProgress,
}: {
  customerId: string;
  inProgress: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inProgress) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 60_000) clearInterval(timer);
      else router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [inProgress, router]);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await sendStatementAction(customerId);
            if (result.ok) {
              setError(null);
              toast.success(result.message);
              router.refresh();
            } else {
              setError(result.error);
            }
          })
        }
      >
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          <Mail aria-hidden="true" data-icon="inline-start" />
        )}
        Enviar por correo
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
