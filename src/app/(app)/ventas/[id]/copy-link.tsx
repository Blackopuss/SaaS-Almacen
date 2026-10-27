"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** The ticket's link, to paste in a message to the customer. */
export function CopyLink({ link }: { link: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
        {link}
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            toast.success("Enlace copiado.");
          } catch {
            toast.error("No se pudo copiar. Selecciónalo y cópialo a mano.");
          }
        }}
      >
        <Copy aria-hidden="true" data-icon="inline-start" />
        Copiar enlace
      </Button>
    </div>
  );
}
