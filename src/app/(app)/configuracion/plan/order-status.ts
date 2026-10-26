import type { OrderView } from "@/platform/billing";

/** How each state of a purchase reads (ADR 0028). */
export const ORDER_STATUS: Record<
  OrderView["status"],
  {
    label: string;
    variant: "success" | "secondary" | "destructive" | "outline";
  }
> = {
  PAID: { label: "Pagada", variant: "success" },
  PENDING: { label: "Esperando confirmación del pago", variant: "secondary" },
  FAILED: { label: "No se completó", variant: "destructive" },
  EXPIRED: { label: "Venció", variant: "outline" },
};
