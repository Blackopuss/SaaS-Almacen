/**
 * Refund terms shown before paying and sent with every purchase (ADR
 * 0028), approved by the founder (2026-10-26). When they change, the
 * version of the terms goes up too (PIL-09). Pure: no database.
 */

/**
 * Contact mailbox (founder, 2026-10-26): the same Gmail account that sends
 * the service's mail. The public site, the legal texts and the receipts use
 * it. Move it to an address of the own domain when there is one.
 */
export const CONTACT_EMAIL = "awsnotificacion@gmail.com";

export const REFUND_DAYS = 10;

export const REFUND_TERMS: readonly string[] = [
  `Puedes pedir el reembolso de una compra dentro de los ${REFUND_DAYS} días naturales siguientes al pago, escribiendo a ${CONTACT_EMAIL} con tu ID de transacción.`,
  "Si lo pides en ese plazo te devolvemos el importe completo; después, solo los meses completos que todavía no empiezan.",
  "El reembolso se hace por el mismo medio con el que pagaste, en un plazo de hasta 20 días hábiles. Al reembolsarse, la vigencia del plan se ajusta a lo que sí se pagó.",
  "Las compras pagadas por completo con un código de descuento no tienen reembolso.",
  "Tus datos no se borran por pedir un reembolso: al terminar la vigencia, la empresa queda en solo lectura y puedes exportarlos.",
];
