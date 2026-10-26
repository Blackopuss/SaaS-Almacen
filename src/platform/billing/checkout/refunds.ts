/**
 * Refund terms shown before paying and sent with every purchase (ADR
 * 0028). Draft written for the pilot: the founder confirms it with the
 * external review of the legal texts (PIL-08) and, when it changes, the
 * version of the terms goes up too (PIL-09). Pure: no database.
 */

/** Pending (founder): the real contact mailbox; the public site uses it too. */
export const CONTACT_EMAIL = "contacto@almacen.mx";

export const REFUND_DAYS = 10;

export const REFUND_TERMS: readonly string[] = [
  `Puedes pedir el reembolso de una compra dentro de los ${REFUND_DAYS} días naturales siguientes al pago, escribiendo a ${CONTACT_EMAIL} con tu ID de transacción.`,
  "Si lo pides en ese plazo te devolvemos el importe completo; después, solo los meses completos que todavía no empiezan.",
  "El reembolso se hace por el mismo medio con el que pagaste, en un plazo de hasta 20 días hábiles. Al reembolsarse, la vigencia del plan se ajusta a lo que sí se pagó.",
  "Las compras pagadas por completo con un código de descuento no tienen reembolso.",
  "Tus datos no se borran por pedir un reembolso: al terminar la vigencia, la empresa queda en solo lectura y puedes exportarlos.",
];
