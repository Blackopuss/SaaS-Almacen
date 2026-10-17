/**
 * States of a purchase order and the moves between them (CMP-05). Pure:
 * the one table every service, screen and the database trigger agree on.
 *
 *   Borrador ──▶ Enviada ──▶ Recibida en parte ──▶ Recibida
 *      │            │  └──────────────│────────────────▲
 *      ▼            ▼                 ▼
 *   Cancelada    Cancelada    Cerrada con faltante
 *
 * - A draft is sent by a person, or cancelled.
 * - A sent order is cancelled only while nothing of it was received.
 * - Receipts move it forward (CMP-07, CMP-08); nothing moves it back.
 * - An order received in part is not cancelled — what arrived is history;
 *   it is closed with its shortage (CMP-11).
 * - Received, cancelled and closed are final.
 */
export const PURCHASE_ORDER_STATUS_LABELS = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  PARTIAL: "Recibida en parte",
  RECEIVED: "Recibida",
  CANCELLED: "Cancelada",
  CLOSED: "Cerrada con faltante",
} as const;

export type PurchaseOrderStatus = keyof typeof PURCHASE_ORDER_STATUS_LABELS;

export const PURCHASE_ORDER_STATUSES = Object.keys(
  PURCHASE_ORDER_STATUS_LABELS,
) as PurchaseOrderStatus[];

export const isPurchaseOrderStatus = (
  value: unknown,
): value is PurchaseOrderStatus =>
  typeof value === "string" &&
  Object.hasOwn(PURCHASE_ORDER_STATUS_LABELS, value);

/** Where an order may go from each state. */
export const PURCHASE_ORDER_TRANSITIONS: Record<
  PurchaseOrderStatus,
  readonly PurchaseOrderStatus[]
> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["PARTIAL", "RECEIVED", "CANCELLED"],
  PARTIAL: ["RECEIVED", "CLOSED"],
  RECEIVED: [],
  CANCELLED: [],
  CLOSED: [],
};

export const canTransition = (
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean => PURCHASE_ORDER_TRANSITIONS[from].includes(to);

/** Why an order in a state cannot be taken to another, for people. */
export function transitionProblem(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): string | null {
  if (canTransition(from, to)) return null;
  if (from === to) {
    return `Esta orden ya está ${stateText(from)}.`;
  }
  if (from === "CANCELLED") {
    return "Esta orden está cancelada: ya no cambia de estado. Haz una nueva.";
  }
  if (from === "CLOSED") {
    return "Esta orden se cerró con faltante: ya no cambia de estado. Lo que falte, pídelo en otra orden.";
  }
  if (from === "RECEIVED") {
    return "Esta orden ya se recibió completa: ya no cambia de estado.";
  }
  if (from === "PARTIAL" && to === "CANCELLED") {
    return "Ya se recibió una parte de esta orden: no se cancela. Lo que falte se cierra como faltante.";
  }
  if (from === "SENT" && to === "CLOSED") {
    return "Todavía no llega nada de esta orden: si ya no la esperas, cancélala.";
  }
  if (to === "DRAFT") {
    return "Una orden enviada no vuelve a ser borrador. Si cambió lo que pides, cancélala y haz otra.";
  }
  if (from === "DRAFT") {
    return "Primero confirma la orden como enviada; después se recibe.";
  }
  return `Una orden ${stateText(from)} no puede pasar a ${stateText(to)}.`;
}

function stateText(status: PurchaseOrderStatus): string {
  return {
    DRAFT: "en borrador",
    SENT: "enviada",
    PARTIAL: "recibida en parte",
    RECEIVED: "recibida",
    CANCELLED: "cancelada",
    CLOSED: "cerrada con faltante",
  }[status];
}
