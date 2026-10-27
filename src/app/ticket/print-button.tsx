"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Prints the page: the ticket, 80 mm wide (VEN-15). */
export function PrintButton({
  variant = "outline",
}: {
  variant?: "default" | "outline";
}) {
  return (
    <Button type="button" variant={variant} onClick={() => window.print()}>
      <Printer aria-hidden="true" data-icon="inline-start" />
      Imprimir ticket
    </Button>
  );
}
