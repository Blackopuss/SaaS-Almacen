"use client";

import { Copy, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "./ui/button";

/**
 * MFA backup codes shown once (PLT-09), with copy and download so they
 * can be kept outside the phone.
 */
export function BackupCodesList({ codes }: { codes: string[] }) {
  const text = [
    "Códigos de recuperación de Almacén",
    "Cada código sirve una sola vez. Guárdalos en un lugar seguro.",
    "",
    ...codes,
  ].join("\n");

  return (
    <div className="space-y-3">
      <ol
        aria-label="Códigos de recuperación"
        className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codes.join("\n"));
              toast.success("Códigos copiados.");
            } catch {
              toast.error("No se pudieron copiar. Descárgalos o anótalos.");
            }
          }}
        >
          <Copy aria-hidden="true" data-icon="inline-start" />
          Copiar
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([text], { type: "text/plain;charset=utf-8" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "almacen-codigos-de-recuperacion.txt";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Download aria-hidden="true" data-icon="inline-start" />
          Descargar
        </Button>
      </div>
    </div>
  );
}
