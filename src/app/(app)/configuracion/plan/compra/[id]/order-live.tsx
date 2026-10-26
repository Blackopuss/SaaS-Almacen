"use client";

import { Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** How often the page asks again while the payment is not confirmed. */
const REFRESH_MS = 5_000;
/** After this long it stops by itself; reloading the page asks again. */
const REFRESH_FOR_MS = 10 * 60_000;

/** Asks the server again (it asks the provider) while the order waits. */
export function PendingRefresh() {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > REFRESH_FOR_MS) clearInterval(timer);
      else router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}

export function CopyButton({ text }: { text: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.success("ID de transacción copiado.");
        } catch {
          toast.error("No se pudo copiar. Anótalo.");
        }
      }}
    >
      <Copy aria-hidden="true" data-icon="inline-start" />
      Copiar
    </Button>
  );
}
