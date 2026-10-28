"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Prints the page: the ticket, 80 mm wide (VEN-15), or a receipt. */
export function PrintButton({
  variant = "outline",
  label = "Imprimir ticket",
}: {
  variant?: "default" | "outline";
  label?: string;
}) {
  return (
    <Button type="button" variant={variant} onClick={() => window.print()}>
      <Printer aria-hidden="true" data-icon="inline-start" />
      {label}
    </Button>
  );
}
