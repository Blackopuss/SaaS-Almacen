/**
 * States of a quote and the moves between them (COT-04). Pure: the one
 * table services, screens and the database trigger agree on.
 *
 *   Borrador ──▶ Enviada ──▶ Aceptada
 *                    └──────▶ Rechazada
 *
 * - A draft is sent: by mail (COT-03) or marked as handed over.
 * - A sent quote is accepted or rejected by what the customer answered.
 * - «Vencida» is not a state: a sent quote whose day passed reads as
 *   expired; it may still be rejected, never accepted.
 * - Accepted and rejected are final.
 */

export type StoredQuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED";

export const QUOTE_TRANSITIONS: Record<
  StoredQuoteStatus,
  readonly StoredQuoteStatus[]
> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: [],
};

export const canQuoteTransition = (
  from: StoredQuoteStatus,
  to: StoredQuoteStatus,
): boolean => QUOTE_TRANSITIONS[from].includes(to);

/**
 * Why a quote cannot go from one state to another, for people; null when
 * it can. `expired` is whether its last day already passed.
 */
export function quoteTransitionProblem(
  from: StoredQuoteStatus,
  to: StoredQuoteStatus,
  expired: boolean,
): string | null {
  if (from === to) return null;
  if (from === "ACCEPTED") return "Esta cotización ya se aceptó.";
  if (from === "REJECTED") return "Esta cotización ya se rechazó.";
  if (from === "DRAFT" && to !== "SENT") {
    return "Primero envía la cotización al cliente.";
  }
  if (!canQuoteTransition(from, to)) {
    return "Una cotización enviada ya no vuelve a borrador.";
  }
  if (to === "ACCEPTED" && expired) {
    return "Esta cotización ya venció: haz una nueva con los precios de hoy.";
  }
  if (to === "SENT" && expired) {
    return "La vigencia ya pasó: cámbiala antes de enviarla.";
  }
  return null;
}
